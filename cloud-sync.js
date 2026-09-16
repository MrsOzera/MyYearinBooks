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
    body:body ? JSON.stringify(body) : undefined
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

async function startCloudSync(){
  let token=localStorage.getItem(SYNC_TOKEN_KEY);
  if(!token){
    token=prompt("Enter your private cloud sync key. It will be stored only on this device.");
    if(!token){ showSyncStatus("cloud sync off"); return; }
    localStorage.setItem(SYNC_TOKEN_KEY,token.trim());
  }

  showSyncStatus("checking cloud…");
  try{
    const cloud=await cloudRequest("GET");
    const local=getLocalState();
    const cloudEmpty=(!cloud.books?.length && !cloud.seriesFolders?.length);
    const localEmpty=(!local.books.length && !local.seriesFolders.length);

    if(cloudEmpty && !localEmpty){
      await uploadLocalState();
    }else if(!cloudEmpty && localEmpty){
      await applyCloudState(cloud);
    }else if(!cloudEmpty && !localEmpty){
      const last=localStorage.getItem(SYNC_LAST_STATE_KEY);
      const localStr=JSON.stringify(local);
      const cloudStr=JSON.stringify(cloud);
      if(localStr===cloudStr){
        localStorage.setItem(SYNC_LAST_STATE_KEY,localStr);
        showSyncStatus("cloud synced ♡");
      }else if(last===localStr){
        await applyCloudState(cloud);
      }else{
        await uploadLocalState();
      }
    }else{
      localStorage.setItem(SYNC_LAST_STATE_KEY,JSON.stringify(local));
      showSyncStatus("cloud synced ♡");
    }

    let previous=localStateString();
    setInterval(async()=>{
      const current=localStateString();
      if(current!==previous){
        previous=current;
        showSyncStatus("syncing…");
        try{ await uploadLocalState(); }
        catch(e){ showSyncStatus("sync pending"); }
      }
    },1500);
  }catch(e){
    if(e.message==="UNAUTHORIZED"){
      localStorage.removeItem(SYNC_TOKEN_KEY);
      alert("The sync key was not accepted. Reload the page and enter it again.");
      showSyncStatus("cloud sync locked");
    }else{
      showSyncStatus("cloud unavailable");
    }
  }
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

startCloudSync();
