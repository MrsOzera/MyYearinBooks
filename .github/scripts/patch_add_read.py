from pathlib import Path

p = Path("index.html")
s = p.read_text(encoding="utf-8")
marker = "data-add-read-collapse-v1"

if marker in s:
    raise SystemExit(0)

old = '  <section class="card form-card">\n    <h2 class="form-title script" id="formHeading">New Read</h2>'
new = '  <div class="actions" id="addReadToggleWrap" style="margin:0 0 14px">\n    <button class="primary" type="button" id="addReadBtn">＋ Add New Read</button>\n  </div>\n\n  <section class="card form-card hidden-field" id="bookFormCard" data-add-read-collapse-v1>\n    <h2 class="form-title script" id="formHeading">New Read</h2>'
if old not in s:
    raise SystemExit("Could not find add-book form opening")
s = s.replace(old, new, 1)

for subtitle in (
    '      <p class="visual-subtitle">January to December at a glance.</p>\n',
    '      <p class="visual-subtitle">Total pages assigned to the month each book was finished.</p>\n',
    '      <p class="visual-subtitle">How your average rating changed through the year.</p>\n',
):
    s = s.replace(subtitle, "", 1)

hook = '\n<script src="cloud-sync.js"></script>'
behavior = r'''
<script>
(() => {
  const formCard=document.getElementById("bookFormCard");
  const addReadBtn=document.getElementById("addReadBtn");
  const addReadToggleWrap=document.getElementById("addReadToggleWrap");
  const bookForm=document.getElementById("bookForm");
  const cancelBtn=document.getElementById("cancelBtn");

  function openReadForm(){
    formCard?.classList.remove("hidden-field");
    if(addReadToggleWrap) addReadToggleWrap.classList.add("hidden-field");
    requestAnimationFrame(()=>formCard?.scrollIntoView({behavior:"smooth",block:"start"}));
  }

  function closeReadForm(){
    formCard?.classList.add("hidden-field");
    if(addReadToggleWrap) addReadToggleWrap.classList.remove("hidden-field");
  }

  addReadBtn?.addEventListener("click",()=>{
    if(typeof editingId!=="undefined") editingId=null;
    bookForm?.reset();
    if(typeof resetForm==="function") resetForm();
    openReadForm();
  });

  if(typeof window.editBook==="function"){
    const originalEditBook=window.editBook;
    window.editBook=id=>{
      openReadForm();
      originalEditBook(id);
    };
  }

  bookForm?.addEventListener("submit",()=>setTimeout(closeReadForm,0));
  cancelBtn?.addEventListener("click",()=>setTimeout(closeReadForm,0));
})();
</script>'''
if hook not in s:
    raise SystemExit("Could not find cloud-sync script hook")
s = s.replace(hook, behavior + hook, 1)

p.write_text(s, encoding="utf-8")
