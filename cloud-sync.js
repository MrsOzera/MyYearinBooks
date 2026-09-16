const CLOUD_API = "https://myyearinbooksapi.williams-leandra-53.workers.dev";
const SYNC_TOKEN_KEY = "myYearInBooksSyncToken";
const SYNC_LAST_STATE_KEY = "myYearInBooksLastSyncedState";
const LAST_READING_YEAR_KEY = "myYearInBooksLastReadingYear";

function getLocalState(){
  return {
    books: Array.isArray(books) ? books : [],
    seriesFolders: Array.isArray(seriesFolders) ? seriesFolders : []
  };
}

function localStateString(){
  return JSON.stringify(getLocalState());
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

async function cloudRequest(method, body){
  const token=localStorage.getItem(SYNC_TOKEN_KEY);
  if(!token) throw new Error("NO_TOKEN");
  const res=await fetch(CLOUD_API+"/state",{
    method,
    headers:{"Content-Type":"application/json","Authorization":"Bearer "+token},
    body:body ? JSON.stringify(body) : undefined,
    cache:"no-store"
  });
  if(res.status===401) throw new Error("UNAUTHORIZED");
  if(!res.ok) throw new Error("HTTP_"+res.status);
  return res.json();
}

async function uploadLocalState(){
  const state=getLocalState();
  await cloudRequest("PUT",state);
  const s=JSON.stringify(state);
  localStorage.setItem(SYNC_LAST_STATE_KEY,s);
  showSyncStatus("cloud synced ♡");
}

async function applyCloudState(state){
  books=Array.isArray(state.books)?state.books:[];
  seriesFolders=Array.isArray(state.seriesFolders)?state.seriesFolders:[];
  localStorage.setItem(KEY,JSON.stringify(books));
  localStorage.setItem(SERIES_FOLDERS_KEY,JSON.stringify(seriesFolders));
  render();
  const s=JSON.stringify({books,seriesFolders});
  localStorage.setItem(SYNC_LAST_STATE_KEY,s);
  showSyncStatus("cloud synced ♡");
}

function mergeById(cloudItems,localItems){
  const map=new Map();
  (localItems||[]).forEach(item=>map.set(item.id,item));
  // Cloud wins for an item that exists on both devices, while unique local items are kept.
  (cloudItems||[]).forEach(item=>map.set(item.id,item));
  return [...map.values()];
}

function mergeStates(cloud,local){
  return {
    books:mergeById(cloud.books,local.books),
    seriesFolders:mergeById(cloud.seriesFolders,local.seriesFolders)
  };
}

let syncInProgress=false;
async function reconcileWithCloud(){
  if(syncInProgress)return;
  syncInProgress=true;
  try{
    const cloud=await cloudRequest("GET");
    const local=getLocalState();
    const cloudStr=JSON.stringify({
      books:Array.isArray(cloud.books)?cloud.books:[],
      seriesFolders:Array.isArray(cloud.seriesFolders)?cloud.seriesFolders:[]
    });
    const localStr=JSON.stringify(local);
    const last=localStorage.getItem(SYNC_LAST_STATE_KEY);

    if(cloudStr===localStr){
      localStorage.setItem(SYNC_LAST_STATE_KEY,localStr);
      showSyncStatus("cloud synced ♡");
      return;
    }

    const cloudEmpty=(!cloud.books?.length && !cloud.seriesFolders?.length);
    const localEmpty=(!local.books.length && !local.seriesFolders.length);

    if(cloudEmpty && !localEmpty){
      await uploadLocalState();
      return;
    }

    if(!cloudEmpty && localEmpty){
      await applyCloudState(cloud);
      return;
    }

    // Normal two-device case:
    // if this device hasn't changed since the last sync, pull the cloud copy.
    if(last && last===localStr){
      await applyCloudState(cloud);
      return;
    }

    // If the cloud hasn't changed since our last sync, this device has the new changes.
    if(last && last===cloudStr){
      await uploadLocalState();
      return;
    }

    // First sync on a device, or both sides changed: merge safely.
    // Cloud wins on matching IDs, but unique books/folders from either side are preserved.
    const merged=mergeStates(cloud,local);
    books=merged.books;
    seriesFolders=merged.seriesFolders;
    localStorage.setItem(KEY,JSON.stringify(books));
    localStorage.setItem(SERIES_FOLDERS_KEY,JSON.stringify(seriesFolders));
    render();
    await uploadLocalState();
  }catch(e){
    if(e.message==="UNAUTHORIZED"){
      localStorage.removeItem(SYNC_TOKEN_KEY);
      const replacement=prompt("Your cloud sync key was not accepted. Enter the current sync key:");
      if(replacement){
        localStorage.setItem(SYNC_TOKEN_KEY,replacement.trim());
        showSyncStatus("checking cloud…");
      }else{
        showSyncStatus("cloud sync locked");
      }
    }else{
      showSyncStatus("cloud unavailable");
    }
  }finally{
    syncInProgress=false;
  }
}

async function startCloudSync(){
  let token=localStorage.getItem(SYNC_TOKEN_KEY);
  if(!token){
    token=prompt("Enter your private cloud sync key. It will be stored only on this device.");
    if(!token){ showSyncStatus("cloud sync off"); return; }
    localStorage.setItem(SYNC_TOKEN_KEY,token.trim());
  }

  showSyncStatus("checking cloud…");
  await reconcileWithCloud();

  // Push local edits quickly.
  let previous=localStateString();
  setInterval(async()=>{
    const current=localStateString();
    if(current!==previous){
      previous=current;
      showSyncStatus("syncing…");
      try{ await reconcileWithCloud(); }
      catch(e){ showSyncStatus("sync pending"); }
      previous=localStateString();
    }
  },1500);

  // Also pull changes made on another device while this page stays open.
  setInterval(async()=>{
    if(document.visibilityState==="visible"){
      await reconcileWithCloud();
      previous=localStateString();
    }
  },8000);

  // iPhone Safari often suspends background pages. Sync immediately when it becomes active again.
  document.addEventListener("visibilitychange",async()=>{
    if(document.visibilityState==="visible"){
      showSyncStatus("checking cloud…");
      await reconcileWithCloud();
      previous=localStateString();
    }
  });
  window.addEventListener("focus",async()=>{
    await reconcileWithCloud();
    previous=localStateString();
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

startCloudSync();
