import * as THREE from 'three';
export async function createSurveyLayer({model,camera,host,metadata,invalidate}) {
  const response=await fetch('./survey-contours.json?v=20261102-1');
  if(!response.ok) throw new Error('โหลดข้อมูลสำรวจไม่สำเร็จ');
  const data=await response.json(), group=new THREE.Group();
  group.name='survey-contours'; group.visible=false;
  const offset=metadata.terrainDisplayOffsetMetres||0;
  for(const major of [false,true]) {
    const vertices=[];
    for(const line of data.lines.filter(l=>l.major===major)) {
      for(let i=1;i<line.points.length;i++) for(const p of [line.points[i-1],line.points[i]]) vertices.push(p[0],p[1]+offset+0.04,p[2]);
    }
    const geometry=new THREE.BufferGeometry(); geometry.setAttribute('position',new THREE.Float32BufferAttribute(vertices,3));
    const material=new THREE.LineBasicMaterial({color:major?'#30443c':'#657366',transparent:true,opacity:major?.85:.6});
    group.add(new THREE.LineSegments(geometry,material));
  }
  model.add(group);
  const canvas=document.createElement('canvas'); canvas.id='survey-label-overlay'; canvas.className='survey-label-overlay';
  canvas.setAttribute('aria-label','ป้ายระดับสำรวจ หน่วยเมตร รทก.'); host.append(canvas);
  const ctx=canvas.getContext('2d'); let placements=[];
  const entries=data.labels.map(p=>({...p,position:new THREE.Vector3(p.x,p.elevation+offset+.06,p.z)}));
  const $=id=>document.getElementById(id);
  $('contour-toggle').onchange=e=>{group.visible=e.target.checked;canvas.dataset.linesVisible=String(group.visible);invalidate();};
  for(const id of ['contour-label-toggle','spot-level-toggle']) $(id).onchange=invalidate;
  for(const id of ['contour-toggle','contour-label-toggle','spot-level-toggle']) $(id).disabled=false;
  canvas.dataset.ready='true';canvas.dataset.linesVisible='false';canvas.dataset.lineCount=data.lines.length;
  canvas.dataset.contourCount=entries.filter(p=>p.kind==='contour').length;canvas.dataset.spotCount=entries.filter(p=>p.kind==='spot').length;
  $('survey-status').textContent=`เส้นคอนทัวร์ ${data.lines.length.toLocaleString()} แนว · ป้ายระดับเส้น ${canvas.dataset.contourCount} ป้าย · จุดสำรวจ ${Number(canvas.dataset.spotCount).toLocaleString()} ค่า`;
  function paint(context,scale=1) {
    context.save();context.scale(scale,scale);context.font='600 11px Arial';context.textAlign='center';context.textBaseline='middle';
    for(const p of placements){context.fillStyle=p.kind==='contour'?'#fffef0':'#f0f8ff';context.fillRect(p.x-p.w/2,p.y-9,p.w,18);context.strokeStyle=p.kind==='contour'?'#7c8564':'#839ab0';context.lineWidth=.6;context.strokeRect(p.x-p.w/2,p.y-9,p.w,18);context.fillStyle=p.kind==='contour'?'#253b2d':'#214965';context.fillText(p.text,p.x,p.y);}
    context.restore();
  }
  function update(){
    const width=host.clientWidth,height=host.clientHeight,dpr=Math.min(devicePixelRatio,2);
    if(canvas.width!==Math.round(width*dpr)||canvas.height!==Math.round(height*dpr)){canvas.width=Math.round(width*dpr);canvas.height=Math.round(height*dpr);}
    ctx.clearRect(0,0,canvas.width,canvas.height);placements=[];
    const enabled={contour:$('contour-label-toggle').checked,spot:$('spot-level-toggle').checked};
    const rect=host.getBoundingClientRect();
    const boxes=[...document.querySelectorAll('.bm-marker,.building-name-marker,.map-heading,.view-switch,.compass,.map-tools,.map-bottom,#flood-map-status,#pin-label')].filter(e=>!e.hidden&&e.getClientRects().length).map(e=>{const r=e.getBoundingClientRect();return{x:r.left-rect.left-4,y:r.top-rect.top-4,w:r.width+8,h:r.height+8};});
    model.updateMatrixWorld(true);camera.updateMatrixWorld();
    for(const kind of ['contour','spot']) {
      if(!enabled[kind])continue;
      for(const entry of entries){
        if(entry.kind!==kind)continue;
        const p=model.localToWorld(entry.position.clone()).project(camera),x=(p.x+1)*width/2,y=(1-p.y)*height/2;
        const text=`${entry.elevation<0?'−':'+'}${Math.abs(entry.elevation).toFixed(2)}`,w=text.length*6.5+10;
        if(p.z<=-1||p.z>=1||x<w/2+6||x>width-w/2-6||y<16||y>height-16)continue;
        const b={x:x-w/2-8,y:y-15,w:w+16,h:30};
        if(boxes.some(o=>b.x<o.x+o.w&&b.x+b.w>o.x&&b.y<o.y+o.h&&b.y+b.h>o.y))continue;
        boxes.push(b);placements.push({x,y,w,text,kind});
      }
    }
    canvas.dataset.visibleCount=placements.length;canvas.dataset.contourEnabled=enabled.contour;canvas.dataset.spotEnabled=enabled.spot;
    paint(ctx,dpr);
  }
  return {group,update,draw:(context,scale)=>{update();paint(context,scale);}};
}
