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
function normalizedState(state){
  return {
    books:Array.isArray(state?.books)?state.books:[],
    seriesFolders:Array.isArray(state?.seriesFolders)?state.seriesFolders:[]
  };
}
function localStateString(){ return JSON.stringify(getLocalState()); }
function stateString(state){ return JSON.stringify(normalizedState(state)); }

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

// Safari-friendly transport: POST text/plain so the browser does not need a CORS preflight.
async function cloudRequest(action, state){
  const token=localStorage.getItem(SYNC_TOKEN_KEY);
  if(!token) throw new Error("NO_TOKEN");

  const path=action==="write" ? "/state/write" : "/state/read";
  const payload=action==="write" ? {token,state} : {token};

  let res;
  try{
    res=await fetch(CLOUD_API+path,{
      method:"POST",
      headers:{"Content-Type":"text/plain;charset=UTF-8"},
      body:JSON.stringify(payload),
      cache:"no-store"
    });
  }catch(err){
    throw new Error("NETWORK");
  }

  if(res.status===401) throw new Error("UNAUTHORIZED");
  if(!res.ok) throw new Error("HTTP_"+res.status);
  return res.json();
}

let localDirty=false;
let syncInProgress=false;
let lastSyncError="";

// Mark data dirty at the exact moment the app saves local changes.
const originalPersist=persist;
persist=function(){
  originalPersist();
  localDirty=true;
  showSyncStatus("syncing…");
};
const originalPersistSeriesFolders=persistSeriesFolders;
persistSeriesFolders=function(){
  originalPersistSeriesFolders();
  localDirty=true;
  showSyncStatus("syncing…");
};

async function uploadLocalState(){
  const state=getLocalState();
  await cloudRequest("write",state);
  const s=JSON.stringify(state);
  localStorage.setItem(SYNC_LAST_STATE_KEY,s);
  localDirty=false;
  lastSyncError="";
  showSyncStatus("cloud synced ♡");
}

async function applyCloudState(state){
  const clean=normalizedState(state);
  books=clean.books;
  seriesFolders=clean.seriesFolders;
  localStorage.setItem(KEY,JSON.stringify(books));
  localStorage.setItem(SERIES_FOLDERS_KEY,JSON.stringify(seriesFolders));
  render();
  localStorage.setItem(SYNC_LAST_STATE_KEY,JSON.stringify(clean));
  localDirty=false;
  lastSyncError="";
  showSyncStatus("cloud synced ♡");
}

function mergeById(cloudItems,localItems){
  const map=new Map();
  (localItems||[]).forEach(item=>map.set(item.id,item));
  (cloudItems||[]).forEach(item=>map.set(item.id,item));
  return [...map.values()];
}
function mergeStates(cloud,local){
  return {
    books:mergeById(cloud.books,local.books),
    seriesFolders:mergeById(cloud.seriesFolders,local.seriesFolders)
  };
}

async function handleSyncError(e){
  lastSyncError=e.message||"UNKNOWN";
  if(e.message==="UNAUTHORIZED"){
    localStorage.removeItem(SYNC_TOKEN_KEY);
    const replacement=prompt("Your cloud sync key was not accepted. Enter the current sync key:");
    if(replacement){
      localStorage.setItem(SYNC_TOKEN_KEY,replacement.trim());
      showSyncStatus("checking cloud…");
    }else{
      showSyncStatus("cloud sync locked");
    }
  }else if(e.message==="NETWORK"){
    showSyncStatus("cloud unavailable · local changes kept");
  }else{
    showSyncStatus("sync error · "+e.message);
  }
}

async function syncNow({allowPull=true}={}){
  if(syncInProgress)return;
  syncInProgress=true;
  try{
    if(localDirty){
      await uploadLocalState();
      return;
    }

    const cloud=normalizedState(await cloudRequest("read"));
    const cloudStr=JSON.stringify(cloud);
    const local=getLocalState();
    const localStr=JSON.stringify(local);
    const last=localStorage.getItem(SYNC_LAST_STATE_KEY);

    if(cloudStr===localStr){
      localStorage.setItem(SYNC_LAST_STATE_KEY,localStr);
      showSyncStatus("cloud synced ♡");
      return;
    }

    const cloudEmpty=!cloud.books.length && !cloud.seriesFolders.length;
    const localEmpty=!local.books.length && !local.seriesFolders.length;

    if(cloudEmpty && !localEmpty){
      localDirty=true;
      await uploadLocalState();
      return;
    }
    if(!cloudEmpty && localEmpty){
      if(allowPull) await applyCloudState(cloud);
      return;
    }

    if(last && last===localStr){
      if(allowPull) await applyCloudState(cloud);
      return;
    }

    if(last && last===cloudStr){
      localDirty=true;
      await uploadLocalState();
      return;
    }

    const merged=mergeStates(cloud,local);
    books=merged.books;
    seriesFolders=merged.seriesFolders;
    localStorage.setItem(KEY,JSON.stringify(books));
    localStorage.setItem(SERIES_FOLDERS_KEY,JSON.stringify(seriesFolders));
    render();
    localDirty=true;
    await uploadLocalState();
  }catch(e){
    await handleSyncError(e);
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
  await syncNow({allowPull:true});

  setInterval(async()=>{
    if(localDirty) await syncNow({allowPull:false});
  },1200);

  setInterval(async()=>{
    if(document.visibilityState==="visible" && !localDirty){
      await syncNow({allowPull:true});
    }
  },8000);

  document.addEventListener("visibilitychange",async()=>{
    if(document.visibilityState==="visible"){
      showSyncStatus(localDirty?"syncing…":"checking cloud…");
      await syncNow({allowPull:!localDirty});
    }
  });
  window.addEventListener("focus",async()=>{
    await syncNow({allowPull:!localDirty});
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
      year.value=match[1];month.value=String(Number(match[2]));day.value=String(Number(match[3]));
    }else{
      day.value="";month.value="";
      year.value=String(document.getElementById("year")?.value || selectedYear || new Date().getFullYear());
    }
  };
  control.setYear=()=>{
    year.value=String(document.getElementById("year")?.value || selectedYear || new Date().getFullYear());
    syncHidden();
  };
  control.syncFromHidden();
}
function updateReadingDateYears(){ readingDateControls.forEach(c=>c.setYear()); }
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
