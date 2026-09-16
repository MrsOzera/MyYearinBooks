const CLOUD_API = "https://myyearinbooksapi.williams-leandra-53.workers.dev";
const SYNC_TOKEN_KEY = "myYearInBooksSyncToken";
const SYNC_DIRTY_KEY = "myYearInBooksUnsyncedChanges";
const SYNC_LAST_STATE_KEY = "myYearInBooksLastSyncedState";
const LAST_READING_YEAR_KEY = "myYearInBooksLastReadingYear";

// Keep cloud/local state small. Cover images are loaded from coverUrl instead of storing
// large base64 image blobs in localStorage/D1 (which can hit Safari's storage quota).
function cleanBook(book){
  const copy={...book};
  delete copy.coverDataUrl;
  return copy;
}
function cleanState(state){
  return {
    books:Array.isArray(state?.books)?state.books.map(cleanBook):[],
    seriesFolders:Array.isArray(state?.seriesFolders)?state.seriesFolders:[]
  };
}
function getLocalState(){
  return cleanState({books,seriesFolders});
}
function isEmptyState(state){
  const s=cleanState(state);
  return !s.books.length && !s.seriesFolders.length;
}

function showSyncStatus(text){
  let el=document.getElementById("cloudSyncStatus");
  if(!el){
    el=document.createElement("div");
    el.id="cloudSyncStatus";
    el.style.cssText="position:fixed;right:12px;bottom:12px;z-index:9999;background:#fff;border:1.5px solid #111;border-radius:999px;padding:7px 10px;font:700 12px Trebuchet MS,sans-serif;box-shadow:0 4px 14px rgba(0,0,0,.12)";
    document.body.appendChild(el);
  }
  el.textContent=text;
}

// Do not create/store base64 cover images anymore. Normal cover URLs still display.
try{ cacheCoverAsDataUrl=async()=>""; }catch(_e){}

// Immediately shrink any existing local copy that still contains cached cover images.
try{
  books=(Array.isArray(books)?books:[]).map(cleanBook);
  localStorage.setItem(KEY,JSON.stringify(books));
}catch(_e){
  // If Safari is already at quota, the next successful cloud pull will replace the old entry.
}

// Safari-friendly API transport: POST text/plain avoids a CORS preflight.
async function cloudRequest(action,state){
  const token=localStorage.getItem(SYNC_TOKEN_KEY);
  if(!token) throw new Error("NO_TOKEN");
  const path=action==="write"?"/state/write":"/state/read";
  const payload=action==="write"?{token,state:cleanState(state)}:{token};

  let response;
  try{
    response=await fetch(CLOUD_API+path,{
      method:"POST",
      headers:{"Content-Type":"text/plain;charset=UTF-8"},
      body:JSON.stringify(payload),
      cache:"no-store"
    });
  }catch(_e){
    throw new Error("NETWORK");
  }

  if(response.status===401) throw new Error("UNAUTHORIZED");
  if(response.status===409) throw new Error("PROTECTED");
  if(!response.ok) throw new Error("HTTP_"+response.status);
  return response.json();
}

function markDirty(){
  localStorage.setItem(SYNC_DIRTY_KEY,"1");
  showSyncStatus("syncing…");
}
function clearDirty(){
  localStorage.removeItem(SYNC_DIRTY_KEY);
}
function hasDirtyChanges(){
  return localStorage.getItem(SYNC_DIRTY_KEY)==="1";
}

// Replace the app's persistence functions with lightweight versions and mark only real
// user changes as needing upload.
persist=function(){
  const state=getLocalState();
  try{ localStorage.setItem(KEY,JSON.stringify(state.books)); }
  catch(_e){ showSyncStatus("local storage full · cloud copy safe"); }
  markDirty();
};
persistSeriesFolders=function(){
  try{ localStorage.setItem(SERIES_FOLDERS_KEY,JSON.stringify(seriesFolders)); }
  catch(_e){ showSyncStatus("local storage full · cloud copy safe"); }
  markDirty();
};

async function applyCloudState(state){
  const clean=cleanState(state);
  books=clean.books;
  seriesFolders=clean.seriesFolders;
  try{
    localStorage.setItem(KEY,JSON.stringify(books));
    localStorage.setItem(SERIES_FOLDERS_KEY,JSON.stringify(seriesFolders));
    localStorage.setItem(SYNC_LAST_STATE_KEY,JSON.stringify(clean));
  }catch(_e){
    // The important copy is already in Cloudflare; render it even if Safari refuses cache storage.
  }
  clearDirty();
  render();
  showSyncStatus("cloud synced ♡");
}

async function uploadLocalState(){
  const state=getLocalState();
  // An empty browser cache must never erase a populated cloud library.
  if(isEmptyState(state)){
    clearDirty();
    showSyncStatus("cloud safe · nothing local to upload");
    return;
  }
  await cloudRequest("write",state);
  try{ localStorage.setItem(SYNC_LAST_STATE_KEY,JSON.stringify(state)); }catch(_e){}
  clearDirty();
  showSyncStatus("cloud synced ♡");
}

let syncBusy=false;
async function pullCloud(){
  if(syncBusy || hasDirtyChanges()) return;
  syncBusy=true;
  try{
    const cloud=cleanState(await cloudRequest("read"));
    // Cloud is the source of truth on a clean/new session. An empty local cache never uploads itself.
    if(!isEmptyState(cloud)){
      await applyCloudState(cloud);
    }else{
      showSyncStatus("cloud empty · local copy kept");
    }
  }catch(e){
    handleSyncError(e);
  }finally{
    syncBusy=false;
  }
}

async function pushDirty(){
  if(syncBusy || !hasDirtyChanges()) return;
  syncBusy=true;
  try{
    await uploadLocalState();
  }catch(e){
    handleSyncError(e);
  }finally{
    syncBusy=false;
  }
}

function handleSyncError(e){
  if(e.message==="UNAUTHORIZED"){
    localStorage.removeItem(SYNC_TOKEN_KEY);
    showSyncStatus("cloud sync locked");
    return;
  }
  if(e.message==="PROTECTED"){
    showSyncStatus("cloud protected · empty overwrite blocked");
    return;
  }
  if(e.message==="NETWORK"){
    showSyncStatus(hasDirtyChanges()?"cloud unavailable · local changes kept":"cloud unavailable");
    return;
  }
  showSyncStatus("sync error · "+e.message);
}

async function startCloudSync(){
  let token=localStorage.getItem(SYNC_TOKEN_KEY);
  if(!token){
    token=prompt("Enter your private cloud sync key. It will be stored only on this device.");
    if(!token){ showSyncStatus("cloud sync off"); return; }
    localStorage.setItem(SYNC_TOKEN_KEY,token.trim());
  }

  // If an earlier offline edit is explicitly marked dirty, preserve and upload it first.
  // Otherwise ALWAYS read Cloudflare first. A cleared/new browser session cannot overwrite cloud data.
  if(hasDirtyChanges() && !isEmptyState(getLocalState())){
    showSyncStatus("syncing saved changes…");
    await pushDirty();
  }else{
    clearDirty();
    showSyncStatus("loading cloud…");
    await pullCloud();
  }

  // User edits upload promptly; clean devices periodically pull changes from other devices.
  setInterval(()=>{ if(hasDirtyChanges()) pushDirty(); },2000);
  setInterval(()=>{ if(document.visibilityState==="visible" && !hasDirtyChanges()) pullCloud(); },10000);

  document.addEventListener("visibilitychange",()=>{
    if(document.visibilityState!=="visible") return;
    if(hasDirtyChanges()) pushDirty(); else pullCloud();
  });
  window.addEventListener("focus",()=>{
    if(hasDirtyChanges()) pushDirty(); else pullCloud();
  });
}

// Keep historical years available and remember the year currently being entered.
getYears = function(){
  const now=new Date().getFullYear();
  const remembered=Number(localStorage.getItem(LAST_READING_YEAR_KEY));
  return [...new Set([
    now,
    Number(selectedYear),
    remembered,
    ...books.map(b=>Number(b.year))
  ].filter(y=>Number.isFinite(y)&&y>=1900&&y<=9999))].sort((a,b)=>b-a);
};

const originalSelectYear=window.selectYear;
window.selectYear=y=>{
  localStorage.setItem(LAST_READING_YEAR_KEY,String(y));
  originalSelectYear(y);
  updateReadingDateYears();
};

document.getElementById("bookForm")?.addEventListener("submit",()=>{
  const y=Number(document.getElementById("year")?.value);
  if(Number.isFinite(y)&&y>=1900&&y<=9999){
    localStorage.setItem(LAST_READING_YEAR_KEY,String(y));
  }
});

const rememberedYear=Number(localStorage.getItem(LAST_READING_YEAR_KEY));
if(Number.isFinite(rememberedYear)&&rememberedYear>=1900&&rememberedYear<=9999){
  selectedYear=rememberedYear;
  if(!editingId) yearInput.value=rememberedYear;
  render();
}

// Date controls: keep the reading year filled in while day/month stay free to enter.
const readingDateControls=[];
function setupReadingDateControl(id){
  const hidden=document.getElementById(id);
  if(!hidden || hidden.dataset.yearPrefillReady) return;
  hidden.dataset.yearPrefillReady="1";
  hidden.type="hidden";

  const wrap=document.createElement("div");
  wrap.style.cssText="display:grid;grid-template-columns:minmax(62px,.7fr) 18px minmax(62px,.7fr) 18px minmax(92px,1fr);align-items:center;border:1.5px solid #111;border-radius:16px;background:#fffafb;overflow:hidden;min-height:48px";
  wrap.innerHTML=`
    <input type="number" inputmode="numeric" min="1" max="31" placeholder="DD" aria-label="Day" style="border:0;border-radius:0;background:transparent;text-align:center;padding:13px 8px;box-shadow:none">
    <span style="text-align:center;color:#756a6f">/</span>
    <input type="number" inputmode="numeric" min="1" max="12" placeholder="MM" aria-label="Month" style="border:0;border-radius:0;background:transparent;text-align:center;padding:13px 8px;box-shadow:none">
    <span style="text-align:center;color:#756a6f">/</span>
    <input type="number" inputmode="numeric" min="1900" max="9999" aria-label="Year" readonly style="border:0;border-radius:0;background:transparent;text-align:center;padding:13px 8px;box-shadow:none;font-weight:800">
  `;
  hidden.insertAdjacentElement("afterend",wrap);
  const [day,month,year]=wrap.querySelectorAll("input");
  const control={hidden,wrap,day,month,year};
  readingDateControls.push(control);

  function syncHidden(){
    const y=Number(year.value),m=Number(month.value),d=Number(day.value);
    if(!y || !m || !d){
      hidden.value="";
      hidden.dispatchEvent(new Event("change",{bubbles:true}));
      return;
    }
    const test=new Date(y,m-1,d);
    const valid=test.getFullYear()===y && test.getMonth()===m-1 && test.getDate()===d;
    hidden.value=valid ? `${String(y).padStart(4,"0")}-${String(m).padStart(2,"0")}-${String(d).padStart(2,"0")}` : "";
    hidden.dispatchEvent(new Event("change",{bubbles:true}));
  }

  day.addEventListener("input",syncHidden);
  month.addEventListener("input",syncHidden);

  control.syncFromHidden=()=>{
    const match=String(hidden.value||"").match(/^(\d{4})-(\d{2})-(\d{2})$/);
    if(match){
      year.value=match[1];
      month.value=String(Number(match[2]));
      day.value=String(Number(match[3]));
    }else{
      day.value="";
      month.value="";
      year.value=String(document.getElementById("year")?.value || selectedYear || new Date().getFullYear());
    }
  };
  control.setYear=()=>{
    year.value=String(document.getElementById("year")?.value || selectedYear || new Date().getFullYear());
    syncHidden();
  };
  control.syncFromHidden();
}

function updateReadingDateYears(){
  readingDateControls.forEach(c=>c.setYear());
}

setupReadingDateControl("dateStarted");
setupReadingDateControl("dateFinished");

document.getElementById("year")?.addEventListener("input",()=>{
  const y=Number(document.getElementById("year").value);
  if(Number.isFinite(y)&&y>=1900&&y<=9999){
    localStorage.setItem(LAST_READING_YEAR_KEY,String(y));
    selectedYear=y;
    updateReadingDateYears();
  }
});

const originalEditBook=window.editBook;
window.editBook=id=>{
  originalEditBook(id);
  setTimeout(()=>readingDateControls.forEach(c=>c.syncFromHidden()),0);
};

document.getElementById("bookForm")?.addEventListener("reset",()=>{
  setTimeout(()=>readingDateControls.forEach(c=>c.syncFromHidden()),0);
});

// Allow whole Series Notes folders to be deleted from the folder list.
window.deleteSeriesFolder=id=>{
  const folder=seriesFolders.find(f=>f.id===id);
  if(!folder)return;
  const noteCount=(folder.entries||[]).length;
  const noteWarning=noteCount?` This will also delete ${noteCount} saved note${noteCount===1?"":"s"}.`:"";
  if(!confirm(`Delete “${folder.name}”?${noteWarning}`))return;
  seriesFolders=seriesFolders.filter(f=>f.id!==id);
  if(activeSeriesFolderId===id){
    activeSeriesFolderId=null;
    editingSeriesEntryId=null;
  }
  persistSeriesFolders();
  renderSeriesFolders();
};

const baseRenderSeriesFolders=renderSeriesFolders;
renderSeriesFolders=function(){
  baseRenderSeriesFolders();
  if(activeSeriesFolderId)return;
  const cards=[...document.querySelectorAll("#seriesFolderList .series-folder-card")];
  const ordered=seriesFolders.slice().sort((a,b)=>(b.updatedAt||0)-(a.updatedAt||0));
  cards.forEach((card,index)=>{
    const folder=ordered[index];
    const openButton=card.querySelector(".series-folder-open");
    if(!folder||!openButton||card.querySelector(".series-folder-delete"))return;
    const actions=document.createElement("div");
    actions.className="series-note-actions";
    openButton.replaceWith(actions);
    actions.appendChild(openButton);
    const deleteButton=document.createElement("button");
    deleteButton.type="button";
    deleteButton.className="icon-btn series-folder-delete";
    deleteButton.title="Delete series";
    deleteButton.setAttribute("aria-label",`Delete ${folder.name}`);
    deleteButton.textContent="×";
    deleteButton.addEventListener("click",()=>window.deleteSeriesFolder(folder.id));
    actions.appendChild(deleteButton);
  });
};
renderSeriesFolders();

startCloudSync();
