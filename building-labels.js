import * as THREE from 'three';
export async function createBuildingLabels({model,camera,controls,host,invalidate}) {
 const response=await fetch('./building-names.json?v=20261102-names-1');if(!response.ok)throw new Error('Building labels unavailable');
 const data=await response.json(),$=id=>document.getElementById(id),ns='http://www.w3.org/2000/svg';
 const overlay=document.createElement('div');overlay.id='building-label-overlay';overlay.className='building-label-overlay';overlay.setAttribute('role','group');overlay.setAttribute('aria-label','ชื่ออาคารและสถานที่จาก CAD');host.parentElement.insertBefore(overlay,$('benchmark-overlay'));
 const svg=document.createElementNS(ns,'svg');svg.classList.add('building-leaders');overlay.append(svg);
 let enabled=false,selected=null,placements=[];
 const measure=document.createElement('canvas').getContext('2d');measure.font='500 11px Arial';
 const segmenter=new Intl.Segmenter('th',{granularity:'word'});
 function wrap(text,width){const lines=[''];for(const {segment} of segmenter.segment(text)){if(lines.at(-1)&&measure.measureText(lines.at(-1)+segment).width>width)lines.push(segment.trimStart());else lines[lines.length-1]+=segment;}return lines.map(s=>s.trim());}
 const entries=data.labels.map(p=>{const button=document.createElement('button');button.type='button';button.className='building-name-marker';const lines=wrap(p.name,150);button.textContent=lines.join('\n');button.style.height=`${lines.length*15+14}px`;button.title=p.name;button.setAttribute('aria-label',p.name);button.dataset.buildingId=p.id;button.dataset.easting=p.easting;button.dataset.northing=p.northing;button.hidden=true;overlay.append(button);
 const line=document.createElementNS(ns,'line'),dot=document.createElementNS(ns,'circle');dot.setAttribute('r','3');const group=document.createElementNS(ns,'g');group.append(line,dot);svg.append(group);
 const option=document.createElement('option');option.value=p.id;option.textContent=p.name;$('building-name-select').append(option);
 const entry={point:p,lines,position:new THREE.Vector3(p.x,p.y,p.z),button,line,dot,group};button.onclick=()=>select(p.id,false);return entry;});
 function select(id,focus){selected=entries.find(e=>e.point.id===id)||null;$('building-name-select').value=selected?.point.id||'';if(selected){setEnabled(true);if(focus){const target=model.localToWorld(selected.position.clone());const delta=target.clone().sub(controls.target);camera.position.add(delta);controls.target.copy(target);camera.zoom=Math.max(camera.zoom,2.5);camera.updateProjectionMatrix();controls.update();if(matchMedia('(max-width:760px)').matches)host.scrollIntoView({behavior:'instant',block:'start'});}}invalidate();}
 function setEnabled(value){enabled=value;overlay.hidden=!enabled;$('building-name-toggle').checked=enabled;overlay.dataset.enabled=String(enabled);invalidate();}
 $('building-name-toggle').onchange=e=>setEnabled(e.target.checked);$('building-name-select').onchange=e=>select(e.target.value,true);
 $('building-name-toggle').disabled=false;$('building-name-select').disabled=false;$('building-name-status').textContent=`${entries.length} ชื่อจากเลเยอร์ BD. name · ซูมเพื่อดูชื่อเพิ่มเติม`;
 overlay.dataset.count=entries.length;overlay.dataset.ready='true';setEnabled(false);
 const overlaps=(a,b)=>a.x<b.x+b.w&&a.x+a.w>b.x&&a.y<b.y+b.h&&a.y+a.h>b.y;
 function update(){placements=[];if(!enabled){overlay.dataset.visibleCount='0';return;}
  model.updateMatrixWorld(true);camera.updateMatrixWorld();const w=host.clientWidth,h=host.clientHeight,r=host.getBoundingClientRect();svg.setAttribute('viewBox',`0 0 ${w} ${h}`);
  const boxes=[...document.querySelectorAll('.bm-marker,.map-heading,.view-switch,.compass,.map-tools,.map-bottom,#flood-map-status,#pin-label')].filter(e=>!e.hidden&&e.getClientRects().length).map(e=>{const b=e.getBoundingClientRect();return{x:b.left-r.left-5,y:b.top-r.top-5,w:b.width+10,h:b.height+10};});
  const sorted=[...entries].sort((a,b)=>Number(b===selected)-Number(a===selected));
  for(const e of sorted){e.button.hidden=true;e.group.style.display='none';const p=model.localToWorld(e.position.clone()).project(camera),x=(p.x+1)*w/2,y=(1-p.y)*h/2;if(p.z<=-1||p.z>=1||x<4||x>w-4||y<4||y>h-4)continue;
   const bw=Math.min(166,w-24),bh=e.lines.length*15+14,candidates=[[x-bw/2,y-bh-12],[x-bw/2,y+12],[x+12,y-bh/2],[x-bw-12,y-bh/2]];
   for(const radius of [55,90,125])for(let i=0;i<8;i++){const a=i*Math.PI/4;candidates.push([x+Math.cos(a)*radius-bw/2,y+Math.sin(a)*radius-bh/2]);}
   const box=candidates.map(([left,top])=>({x:left,y:top,w:bw,h:bh})).find(b=>b.x>=6&&b.y>=6&&b.x+b.w<=w-6&&b.y+b.h<=h-6&&!boxes.some(o=>overlaps({x:b.x-4,y:b.y-4,w:b.w+8,h:b.h+8},o)));
   if(!box)continue;boxes.push(box);e.button.hidden=false;e.button.style.left=`${box.x}px`;e.button.style.top=`${box.y}px`;e.button.style.width=`${box.w}px`;e.button.setAttribute('aria-pressed',String(e===selected));e.button.dataset.anchorX=x.toFixed(3);e.button.dataset.anchorY=y.toFixed(3);e.group.style.display='';e.line.setAttribute('x1',x);e.line.setAttribute('y1',y);e.line.setAttribute('x2',Math.max(box.x,Math.min(box.x+box.w,x)));e.line.setAttribute('y2',Math.max(box.y,Math.min(box.y+box.h,y)));e.dot.setAttribute('cx',x);e.dot.setAttribute('cy',y);placements.push({entry:e,box,x,y});
  }overlay.dataset.visibleCount=placements.length;
 }
 function draw(ctx,scale){update();if(!enabled)return;ctx.save();ctx.scale(scale,scale);ctx.font='500 11px Arial';ctx.textAlign='center';ctx.textBaseline='middle';for(const {entry:e,box:b,x,y} of placements){ctx.strokeStyle='#746043';ctx.fillStyle='#746043';ctx.lineWidth=1;ctx.beginPath();ctx.moveTo(x,y);ctx.lineTo(Math.max(b.x,Math.min(b.x+b.w,x)),Math.max(b.y,Math.min(b.y+b.h,y)));ctx.stroke();ctx.beginPath();ctx.arc(x,y,3,0,Math.PI*2);ctx.fill();ctx.fillStyle=e===selected?'#ffe5a6':'#fffdf5';ctx.beginPath();ctx.roundRect(b.x,b.y,b.w,b.h,6);ctx.fill();ctx.stroke();ctx.fillStyle='#483c2d';const lines=e.lines;lines.forEach((line,i)=>ctx.fillText(line,b.x+b.w/2,b.y+b.h/2+(i-(lines.length-1)/2)*15,b.w-12));}ctx.restore();}
 return{update,draw};
}
