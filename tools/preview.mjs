// Offline preview: synthetic data only, no credentials and no outbound network.
import http from 'node:http';
import {readFile} from 'node:fs/promises';
import worker from '../src/worker.js';

const entities = {
  artist: {entity_id:'SYN-ARTIST',name:'Synthetic Band',type:'urn:entity:artist',query:{affinity:0.72}},
  tv_show: {entity_id:'SYN-SHOW',name:'Synthetic Show',type:'urn:entity:tv_show',query:{affinity:0.81}},
  video_game: {entity_id:'SYN-GAME',name:'Synthetic Game',type:'urn:entity:video_game',query:{affinity:0.63}},
};
globalThis.fetch = async url => {
  const u=new URL(url);
  if(u.pathname==='/search') return Response.json({results:[entities.artist]});
  const type=u.searchParams.get('filter.type')?.split(':').at(-1);
  return Response.json({results:{entities:entities[type]?[entities[type]]:[]}});
};
const html=await readFile(new URL('../public/index.html',import.meta.url),'utf8');
const env={QLOO_API_KEY:'synthetic-preview-only',ASSETS:{fetch:async request=>{
  if(new URL(request.url).pathname!=='/')return new Response('Not found',{status:404});
  return new Response(html.replace('<main>','<main><p class="profile">OFFLINE PREVIEW — all entities and scores are synthetic. No Qloo or language model service is connected.</p>'),{headers:{'content-type':'text/html; charset=utf-8'}});
}}};
http.createServer(async(req,res)=>{
  try{
    const chunks=[];let size=0;
    for await(const c of req){size+=c.length;if(size>8192){res.writeHead(413);res.end();return;}chunks.push(c);}
    const response=await worker.fetch(new Request(`http://127.0.0.1:8798${req.url}`,{method:req.method,headers:req.headers,body:['GET','HEAD'].includes(req.method)?undefined:Buffer.concat(chunks)}),env);
    res.writeHead(response.status,Object.fromEntries(response.headers));res.end(Buffer.from(await response.arrayBuffer()));
  }catch{res.writeHead(500);res.end('Preview unavailable');}
}).listen(8798,'127.0.0.1',()=>console.log('Synthetic preview: http://127.0.0.1:8798'));
