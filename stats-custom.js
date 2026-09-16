// Visual refinements for stats: pastel pie palette and line charts for monthly counts/pages.
const pastelPieColors=[
  "#F4B8C4", // blush pink
  "#F6DEA8", // butter yellow
  "#BFD7EA", // powder blue
  "#BFD8C0", // sage green
  "#D7C5E8", // lavender
  "#F5C6A5", // soft peach
  "#FADADD", // baby pink
  "#BFE3DF"  // pale aqua
];

pieSvg = function(data){
  const entries=Object.entries(data).filter(([,v])=>v>0).sort((a,b)=>b[1]-a[1]);
  if(!entries.length)return `<div class="no-data">No data yet.</div>`;
  const total=entries.reduce((s,[,v])=>s+v,0);
  const r=56,cx=72,cy=72,circ=2*Math.PI*r;
  let offset=0;
  const circles=entries.map(([name,value],i)=>{
    const fraction=value/total;
    const dash=fraction*circ;
    const circle=`<circle cx="${cx}" cy="${cy}" r="${r}" fill="none" stroke="${pastelPieColors[i%pastelPieColors.length]}" stroke-width="28" stroke-dasharray="${dash} ${circ-dash}" stroke-dashoffset="${-offset}" transform="rotate(-90 ${cx} ${cy})"></circle>`;
    offset+=dash;
    return circle;
  }).join("");
  return `<div>
    <svg class="pie-svg" viewBox="0 0 144 144" aria-label="Pie chart">
      ${circles}
      <circle cx="72" cy="72" r="38" fill="#fff"></circle>
    </svg>
    <div class="pie-legend">${entries.map(([name,value],i)=>`
      <div class="legend-row">
        <span class="legend-dot" style="background:${pastelPieColors[i%pastelPieColors.length]}"></span>
        <span><strong>${esc(name)}</strong> · ${value} (${Math.round(value/total*100)}%)</span>
      </div>`).join("")}</div>
  </div>`;
};

function monthlyLineChartSvg(values,labels,{integer=false,format=v=>String(v)}={}){
  const w=720,h=260,padL=50,padR=18,padT=22,padB=42;
  const plotW=w-padL-padR,plotH=h-padT-padB;
  const valid=values.filter(v=>Number.isFinite(v));
  let max=Math.max(...valid,1);
  if(integer) max=Math.max(1,Math.ceil(max));
  let svg=`<svg class="chart-svg" viewBox="0 0 ${w} ${h}">`;
  for(let i=0;i<=5;i++){
    const y=padT+plotH-(plotH*i/5);
    const raw=max*i/5;
    const label=integer ? Math.round(raw) : raw;
    svg+=`<line class="chart-grid" x1="${padL}" y1="${y}" x2="${w-padR}" y2="${y}"></line>`;
    svg+=`<text class="chart-value" x="${padL-7}" y="${y+4}" text-anchor="end">${format(label)}</text>`;
  }
  svg+=`<line class="chart-axis" x1="${padL}" y1="${padT+plotH}" x2="${w-padR}" y2="${padT+plotH}"></line>`;
  const pts=[];
  values.forEach((v,i)=>{
    const x=padL+(plotW/(values.length-1))*i;
    const y=padT+plotH-(Number(v||0)/max)*plotH;
    pts.push([x,y,Number(v||0)]);
    svg+=`<text class="chart-label" x="${x}" y="${h-18}" text-anchor="middle">${labels[i]}</text>`;
  });
  if(pts.length>1){
    svg+=`<polyline class="chart-line" points="${pts.map(([x,y])=>`${x},${y}`).join(" ")}"></polyline>`;
  }
  pts.forEach(([x,y,v])=>{
    svg+=`<circle class="chart-point" cx="${x}" cy="${y}" r="5"></circle>`;
    svg+=`<text class="chart-value" x="${x}" y="${Math.max(12,y-9)}" text-anchor="middle">${format(v)}</text>`;
  });
  svg+="</svg>";
  return svg;
}

renderMonths = function(yearBooks){
  const year=Number(selectedYear);
  const monthly=buildMonthlyData(yearBooks);
  const shortLabels=["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];

  monthlyBooksChart.innerHTML=monthlyLineChartSvg(
    monthly.map(m=>m.books),
    shortLabels,
    {integer:true,format:v=>String(Math.round(v))}
  );
  monthlyPagesChart.innerHTML=monthlyLineChartSvg(
    monthly.map(m=>m.pages),
    shortLabels,
    {integer:true,format:v=>Math.round(v).toLocaleString()}
  );
  monthlyRatingChart.innerHTML=lineChartSvg(monthly.map(m=>m.rating),shortLabels);

  monthGrid.innerHTML=monthly.map(m=>{
    const monthBooks=yearBooks.filter(b=>{
      if(!b.dateFinished)return false;
      const d=new Date(b.dateFinished+"T00:00:00");
      return !isNaN(d)&&d.getFullYear()===year&&d.getMonth()===m.month;
    });
    const ratings=monthBooks.map(b=>Number(b.rating)).filter(r=>r>0);
    const avg=average(ratings);
    const names=monthBooks.map(b=>esc(b.title)).join(" · ");
    return `<article class="month-card">
      <div class="month-title">${monthName(m.month)}</div>
      <div class="month-metrics">
        <div class="month-metric"><strong>${m.books}</strong><span>Books finished</span></div>
        <div class="month-metric"><strong>${m.pages.toLocaleString()}</strong><span>Pages</span></div>
        <div class="month-metric"><strong>${(m.pages/daysInMonth(year,m.month)).toFixed(1)}</strong><span>Pages / day</span></div>
        <div class="month-metric"><strong>${avg?avg.toFixed(2)+" ★":"—"}</strong><span>Avg. rating</span></div>
      </div>
      ${names?`<div class="month-books">${names}</div>`:""}
    </article>`;
  }).join("");
};

// Keep wrapped pie-chart titles visually together, e.g. “series journey”.
const pieTitleStyle=document.createElement("style");
pieTitleStyle.textContent=`
  .pie-card .visual-title{
    line-height:.82;
    margin-bottom:10px;
  }
`;
document.head.appendChild(pieTitleStyle);

// Refresh the current view once these overrides are loaded.
render();
