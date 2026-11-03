'use strict';
// Bounded AVM2 transformation. No game code, external tools or executable input.
const crypto = require('crypto');
const fs = require('fs');
const MAX = 32000000;
const ENGINE_VERSION = '1';
function fail(message) { throw new Error('造梦5结构不兼容：' + message); }
function hash(bytes) { return crypto.createHash('sha256').update(bytes).digest('hex'); }
function u30(value) {
  if (!Number.isInteger(value) || value < 0 || value > 0x3fffffff) fail('整数超界');
  const out=[]; do { let b=value&127; value=Math.floor(value/128);out.push(b|(value?128:0)); } while(value);
  return Buffer.from(out);
}
function word(value) { const out=Buffer.alloc(4);out.writeUInt32LE(value);return out; }
function s24(value) { if(value < -0x800000 || value > 0x7fffff)fail('跳转超界');const b=Buffer.alloc(3);b.writeUIntLE(value&0xffffff,0,3);return b; }
class Reader {
  constructor(b) {this.b=b;this.p=0;}
  take(n) {if(!Number.isSafeInteger(n)||n<0||n>this.b.length-this.p)fail('文件截断');const b=this.b.slice(this.p,this.p+n);this.p+=n;return b;}
  byte(){return this.take(1)[0];}
  varint(limit=0x3fffffff){let v=0,shift=0;for(let i=0;i<5;i++){const b=this.byte();if(i===4&&(b&0xf0))fail('整数编码错误');v+=(b&127)*Math.pow(2,shift);if(!(b&128)){if(v>limit)fail('整数超界');return v;}shift+=7;}fail('整数编码错误');}
  count(){const n=this.varint();if(n>1000000||n>this.b.length-this.p+1)fail('表大小异常');return n;}
  short(){return this.take(2).readUInt16LE();}
  signed(){const n=this.take(3).readUIntLE(0,3);return n&0x800000?n-0x1000000:n;}
}
function traits(r) {
  const start=r.p,n=r.count(),out=[];
  for(let i=0;i<n;i++){
    const name=r.varint(),kind=r.byte(),type=kind&15;const t={name,kind,type};
    if(type===0||type===6){t.slot=r.varint();t.typeName=r.varint();t.value=r.varint();if(t.value)t.valueKind=r.byte();}
    else if(type===1||type===2||type===3){t.disp=r.varint();t.method=r.varint();}
    else if(type===4){t.slot=r.varint();t.classIndex=r.varint();}
    else if(type===5){t.slot=r.varint();t.functionIndex=r.varint();}
    else fail('未知trait');
    if(kind&64){const m=r.count();for(let j=0;j<m;j++)r.varint();}
    out.push(t);
  }
  return {items:out,raw:r.b.slice(start,r.p)};
}
function parseABC(bytes) {
  const r=new Reader(bytes);if(r.short()!==16||r.short()!==46)fail('ABC版本');
  const abc={bytes,pools:{},poolSections:[]};
  for(const type of ['int','uint','double','string','namespace','nsset','multiname']){
    const start=r.p,n=r.count(),values=[null];
    for(let i=1;i<n;i++){
      let value;
      if(type==='int') value=r.varint(0xffffffff)|0;
      else if(type==='uint')value=r.varint(0xffffffff);
      else if(type==='double')value=r.take(8).toString('hex');
      else if(type==='string'){const b=r.take(r.varint());value=b.toString('utf8');if(!Buffer.from(value).equals(b))fail('非法UTF8');}
      else if(type==='namespace')value={kind:r.byte(),name:r.varint()};
      else if(type==='nsset'){const len=r.count();value=[];for(let j=0;j<len;j++)value.push(r.varint());}
      else {
        const kind=r.byte();value={kind};
        if(kind===7||kind===13){value.ns=r.varint();value.name=r.varint();}
        else if(kind===15||kind===16)value.name=r.varint();
        else if(kind===17||kind===18){}
        else if(kind===9||kind===14){value.name=r.varint();value.set=r.varint();}
        else if(kind===27||kind===28)value.set=r.varint();
        else if(kind===29){value.base=r.varint();const len=r.count();value.params=[];for(let j=0;j<len;j++)value.params.push(r.varint());}
        else fail('未知multiname');
      }
      values.push(value);
    }
    abc.pools[type]=values;abc.poolSections.push({type,start,end:r.p});
  }
  abc.poolEnd=r.p;abc.methods=[];
  let n=r.count();for(let i=0;i<n;i++){
    const count=r.count(),ret=r.varint(),params=[];for(let j=0;j<count;j++)params.push(r.varint());
    const m={ret,params,name:r.varint(),flags:r.byte(),optional:[],paramNames:[]};
    if(m.flags&8){const len=r.count();if(len>count)fail('可选参数数目');for(let j=0;j<len;j++)m.optional.push([r.varint(),r.byte()]);}
    if(m.flags&128)for(let j=0;j<count;j++)m.paramNames.push(r.varint());abc.methods.push(m);
  }
  n=r.count();for(let i=0;i<n;i++){r.varint();const len=r.count();for(let j=0;j<len*2;j++)r.varint();}
  const classes=r.count();abc.instances=[];abc.classes=[];
  for(let i=0;i<classes;i++){
    const x={name:r.varint(),superName:r.varint(),flags:r.byte()};if(x.flags&8)x.protected=r.varint();
    const len=r.count();for(let j=0;j<len;j++)r.varint();x.init=r.varint();x.traits=traits(r);abc.instances.push(x);
  }
  for(let i=0;i<classes;i++)abc.classes.push({init:r.varint(),traits:traits(r)});
  n=r.count();for(let i=0;i<n;i++){r.varint();traits(r);}
  n=r.count();abc.bodies=[];
  for(let i=0;i<n;i++){
    const start=r.p;const x={start,method:r.varint(),stack:r.varint(),locals:r.varint(),scope:r.varint(),maxScope:r.varint()};
    x.code=r.take(r.varint());const len=r.count();x.exceptions=[];
    for(let j=0;j<len;j++)x.exceptions.push({from:r.varint(),to:r.varint(),target:r.varint(),type:r.varint(),name:r.varint()});
    x.traits=traits(r);x.end=r.p;abc.bodies.push(x);
  }
  if(r.p!==bytes.length)fail('ABC尾部数据');
  return abc;
}
function at(a,index){if(!Number.isInteger(index)||index<0||index>=a.length)fail('索引越界');return a[index];}
function symbol(abc,type,index,depth=0){
  if(depth>30)fail('常量递归');if(index===0)return null;
  const v=at(abc.pools[type],index),next=(t,i)=>symbol(abc,t,i,depth+1);
  if(type==='namespace')return {kind:v.kind,name:next('string',v.name)};
  if(type==='nsset')return v.map(i=>next('namespace',i));
  if(type==='multiname'){
    const out={kind:v.kind};if(v.ns!==undefined)out.ns=next('namespace',v.ns);if(v.name!==undefined)out.name=next('string',v.name);
    if(v.set!==undefined)out.set=next('nsset',v.set);if(v.base!==undefined)out.base=next('multiname',v.base);
    if(v.params)out.params=v.params.map(i=>next('multiname',i));return out;
  }
  return v;
}
function key(v){return JSON.stringify(v);}
function methodSymbol(abc,index){const m=at(abc.methods,index);return {name:symbol(abc,'string',m.name),ret:symbol(abc,'multiname',m.ret),params:m.params.map(i=>symbol(abc,'multiname',i)),flags:m.flags};}
function classSymbol(abc,index){return symbol(abc,'multiname',at(abc.instances,index).name);}
function targetBody(abc){
  const found=[];
  abc.instances.forEach(x=>{const name=symbol(abc,'multiname',x.name);if(name&&name.kind===7&&name.name==='DamageControl'&&name.ns.kind===22&&name.ns.name==='prefabs.controls'){
    x.traits.items.forEach(t=>{const name=symbol(abc,'multiname',t.name);if(t.type===1&&name&&name.name==='onHurt'&&name.ns.kind===5&&name.ns.name==='prefabs.controls:DamageControl'){
      const bodies=abc.bodies.filter(b=>b.method===t.method);if(bodies.length!==1)fail('方法体不唯一');found.push(bodies[0]);
    }});
  }});
  if(found.length>1)fail('伤害方法不唯一');return found[0];
}

// Operand arities are AVM2 instruction-format facts (Adobe ABC 46.16).
const OPCODES={"1":["bkpt",0],"2":["nop",0],"3":["throw",0],"4":["getsuper",1],"5":["setsuper",1],"6":["dxns",1],"7":["dxnslate",0],"8":["kill",1],"9":["label",0],"12":["ifnlt",1],"13":["ifnle",1],"14":["ifngt",1],"15":["ifnge",1],"16":["jump",1],"17":["iftrue",1],"18":["iffalse",1],"19":["ifeq",1],"20":["ifne",1],"21":["iflt",1],"22":["ifle",1],"23":["ifgt",1],"24":["ifge",1],"25":["ifstricteq",1],"26":["ifstrictne",1],"27":["lookupswitch",2],"28":["pushwith",0],"29":["popscope",0],"30":["nextname",0],"31":["hasnext",0],"32":["pushnull",0],"33":["pushundefined",0],"35":["nextvalue",0],"36":["pushbyte",1],"37":["pushshort",1],"38":["pushtrue",0],"39":["pushfalse",0],"40":["pushnan",0],"41":["pop",0],"42":["dup",0],"43":["swap",0],"44":["pushstring",1],"45":["pushint",1],"46":["pushuint",1],"47":["pushdouble",1],"48":["pushscope",0],"49":["pushnamespace",1],"50":["hasnext2",2],"53":["li8",0],"54":["li16",0],"55":["li32",0],"56":["lf32",0],"57":["lf64",0],"58":["si8",0],"59":["si16",0],"60":["si32",0],"61":["sf32",0],"62":["sf64",0],"64":["newfunction",1],"65":["call",1],"66":["construct",1],"67":["callmethod",2],"68":["callstatic",2],"69":["callsuper",2],"70":["callproperty",2],"71":["returnvoid",0],"72":["returnvalue",0],"73":["constructsuper",1],"74":["constructprop",2],"76":["callproplex",2],"78":["callsupervoid",2],"79":["callpropvoid",2],"80":["sxi1",0],"81":["sxi8",0],"82":["sxi16",0],"83":["applytype",1],"85":["newobject",1],"86":["newarray",1],"87":["newactivation",0],"88":["newclass",1],"89":["getdescendants",1],"90":["newcatch",1],"93":["findpropstrict",1],"94":["findproperty",1],"95":["finddef",1],"96":["getlex",1],"97":["setproperty",1],"98":["getlocal",1],"99":["setlocal",1],"100":["getglobalscope",0],"101":["getscopeobject",1],"102":["getproperty",1],"103":["getouterscope",1],"104":["initproperty",1],"106":["deleteproperty",1],"108":["getslot",1],"109":["setslot",1],"110":["getglobalslot",1],"111":["setglobalslot",1],"112":["convert_s",0],"113":["esc_xelem",0],"114":["esc_xattr",0],"115":["convert_i",0],"116":["convert_u",0],"117":["convert_d",0],"118":["convert_b",0],"119":["convert_o",0],"120":["checkfilter",0],"128":["coerce",1],"129":["coerce_b",0],"130":["coerce_a",0],"131":["coerce_i",0],"132":["coerce_d",0],"133":["coerce_s",0],"134":["astype",1],"135":["astypelate",0],"136":["coerce_u",0],"137":["coerce_o",0],"144":["negate",0],"145":["increment",0],"146":["inclocal",1],"147":["decrement",0],"148":["declocal",1],"149":["typeof",0],"150":["not",0],"151":["bitnot",0],"160":["add",0],"161":["subtract",0],"162":["multiply",0],"163":["divide",0],"164":["modulo",0],"165":["lshift",0],"166":["rshift",0],"167":["urshift",0],"168":["bitand",0],"169":["bitor",0],"170":["bitxor",0],"171":["equals",0],"172":["strictequals",0],"173":["lessthan",0],"174":["lessequals",0],"175":["greaterthan",0],"176":["greaterequals",0],"177":["instanceof",0],"178":["istype",1],"179":["istypelate",0],"180":["in",0],"192":["increment_i",0],"193":["decrement_i",0],"194":["inclocal_i",1],"195":["declocal_i",1],"196":["negate_i",0],"197":["add_i",0],"198":["subtract_i",0],"199":["multiply_i",0],"208":["getlocal0",0],"209":["getlocal1",0],"210":["getlocal2",0],"211":["getlocal3",0],"212":["setlocal0",0],"213":["setlocal1",0],"214":["setlocal2",0],"215":["setlocal3",0],"239":["debug",4],"240":["debugline",1],"241":["debugfile",1],"242":["bkptline",1],"243":["timestamp",0]};
const POOL_OPS={4:'multiname',5:'multiname',6:'string',44:'string',45:'int',46:'uint',47:'double',49:'namespace',69:'multiname',70:'multiname',74:'multiname',76:'multiname',78:'multiname',79:'multiname',89:'multiname',93:'multiname',94:'multiname',95:'multiname',96:'multiname',97:'multiname',102:'multiname',104:'multiname',106:'multiname',128:'multiname',134:'multiname',178:'multiname',241:'string'};
const LOCAL_OPS=new Set([8,98,99,146,148,194,195]);
function decode(code,abc){
  const r=new Reader(code),out=[];
  while(r.p<code.length){
    const offset=r.p,op=r.byte(),meta=OPCODES[op];if(!meta)fail('未知指令0x'+op.toString(16));
    const x={offset,op,args:[]};
    if(op>=12&&op<=26)x.args=[r.p+3+r.signed()];
    else if(op===27){const def=offset+r.signed(),n=r.varint();if(n>100000||n*3>code.length-r.p)fail('switch大小');x.args=[def,n];for(let i=0;i<=n;i++)x.args.push(offset+r.signed());}
    else if(op===36)x.args=[r.byte()];
    else if(op===101)x.args=[r.byte()];
    else if(op===239)x.args=[r.byte(),r.varint(),r.byte(),r.varint()];
    else {if(meta[1]<0||meta[1]>3)fail('未支持指令');for(let i=0;i<meta[1];i++)x.args.push(r.varint());}
    x.end=r.p;out.push(x);
  }
  const labels=new Map(out.map((x,i)=>[x.offset,i]));labels.set(code.length,out.length);
  const target=p=>{if(!labels.has(p))fail('跳转不在指令边界');return labels.get(p);};
  out.forEach(x=>{
    if(x.op>=12&&x.op<=26)x.args=[{label:target(x.args[0])}];
    else if(x.op===27)x.args=x.args.map((v,i)=>i===1?v:{label:target(v)});
    else if(POOL_OPS[x.op]){const index=x.args[0];x.args[0]={pool:POOL_OPS[x.op],value:symbol(abc,POOL_OPS[x.op],index)};Object.defineProperty(x.args[0],'originalIndex',{value:index});}
    else if(x.op===64||x.op===68){const index=x.args[0];x.args[0]={method:methodSymbol(abc,index)};Object.defineProperty(x.args[0],'originalIndex',{value:index});}
    else if(x.op===88){const index=x.args[0];x.args[0]={class:classSymbol(abc,index)};Object.defineProperty(x.args[0],'originalIndex',{value:index});}
    else if(x.op===239){const index=x.args[1];x.args[1]={pool:'string',value:symbol(abc,'string',index)};Object.defineProperty(x.args[1],'originalIndex',{value:index});}
    if(x.op>=208&&x.op<=211){x.args=[x.op-208];x.op=98;}
    else if(x.op>=212&&x.op<=215){x.args=[x.op-212];x.op=99;}
  });
  return {instructions:out,labels,target};
}
function normalize(abc,body){
  if(body.code.length>200000||body.locals>4096)fail('伤害方法大小');
  const decoded=decode(body.code,abc),locals=new Map([[0,0],[1,1],[2,2]]),actual=[];
  const local=n=>{if(n>=body.locals)fail('寄存器越界');if(!locals.has(n))locals.set(n,locals.size);actual[locals.get(n)]=n;return locals.get(n);};
  const code=decoded.instructions.map(x=>{const args=x.args.map(v=>v&&typeof v==='object'?v:v);if(LOCAL_OPS.has(x.op))args[0]={local:local(args[0])};if(x.op===50){args[0]={local:local(args[0])};args[1]={local:local(args[1])};}if(x.op===239)args[2]={local:local(args[2])};return {op:x.op,args};});
  const exceptions=body.exceptions.map(e=>({from:decoded.target(e.from),to:decoded.target(e.to),target:decoded.target(e.target),type:symbol(abc,'multiname',e.type),name:symbol(abc,'multiname',e.name)}));
  const signature=methodSymbol(abc,body.method);
  const canonical={signature,stack:body.stack,locals:body.locals,scope:body.scope,maxScope:body.maxScope,code,exceptions};
  if(body.traits.items.length)fail('方法内traits');
  return {fingerprint:hash(Buffer.from(key(canonical))),canonical,decoded,actual,locals};
}
function swf(input){
  if(!Buffer.isBuffer(input)||input.length<16||input.length>MAX||input.slice(0,3).toString()!=='FWS'||input.readUInt32LE(4)!==input.length)fail('需完整FWS文件');
  const rect=(5+4*(input[8]>>3)+7)>>3;let p=8+rect+4;if(p>input.length)fail('SWF头部');const tags=[];let ended=false;
  while(p<input.length){const start=p;if(p+2>input.length)fail('标签截断');const h=input.readUInt16LE(p);p+=2;const type=h>>6;let size=h&63;if(size===63){if(p+4>input.length)fail('标签截断');size=input.readUInt32LE(p);p+=4;}if(size>input.length-p)fail('标签长度');const payload=p,end=p+size;tags.push({start,payload,end,type});p=end;if(type===0){if(size!==0||p!==input.length)fail('结束标签');ended=true;break;}}
  if(!ended)fail('缺少结束标签');return tags;
}
function locate(input){
  const found=[];
  for(const tag of swf(input)){
    if(tag.type!==82&&tag.type!==72)continue;
    let start=tag.payload;
    if(tag.type===82){if(tag.end-start<5)fail('ABC标签');start+=4;const end=input.indexOf(0,start);if(end<start||end>=tag.end)fail('ABC名称');start=end+1;}
    const abc=parseABC(input.slice(start,tag.end));const body=targetBody(abc);if(body)found.push({tag,start,abc,body});
  }
  if(found.length!==1)fail('未找到唯一伤害方法');return found[0];
}
function requirePrivateBinding(abc,name){
  const matches=abc.pools.namespace.filter(v=>v&&v.kind===5&&symbol(abc,'string',v.name)===name);
  if(matches.length!==1)fail('私有命名空间不唯一');
}
function validatePrivateBindings(abc,value){
  if(!value||typeof value!=='object')return;
  if(value.kind===5&&Object.prototype.hasOwnProperty.call(value,'name'))requirePrivateBinding(abc,value.name);
  if(Array.isArray(value))value.forEach(v=>validatePrivateBindings(abc,v));
  else Object.keys(value).forEach(k=>validatePrivateBindings(abc,value[k]));
}
function addPool(abc,type,value,cache){
  if(value===null)return 0;
  validatePrivateBindings(abc,value);
  const id=type+':'+key(value);if(cache.has(id))return cache.get(id);
  const pool=abc.pools[type];
  if(!cache.indices)cache.indices=new Map();
  if(!cache.indices.has(type)){
    const index=new Map();for(let i=1;i<pool.length;i++){const k=key(symbol(abc,type,i));if(index.has(k)&&type==='namespace'&&pool[i].kind===5)index.set(k,-1);else if(!index.has(k))index.set(k,i);}
    cache.indices.set(type,index);
  }
  const index=cache.indices.get(type),existing=index.get(key(value));
  if(existing===-1)fail('私有命名空间不唯一');
  if(existing!==undefined){cache.set(id,existing);return existing;}
  let v=value;
  if(type==='namespace')v={kind:value.kind,name:addPool(abc,'string',value.name,cache)};
  else if(type==='nsset')v=value.map(x=>addPool(abc,'namespace',x,cache));
  else if(type==='multiname'){
    v={kind:value.kind};if(value.ns!==undefined)v.ns=addPool(abc,'namespace',value.ns,cache);if(value.name!==undefined)v.name=addPool(abc,'string',value.name,cache);
    if(value.set!==undefined)v.set=addPool(abc,'nsset',value.set,cache);if(value.base!==undefined)v.base=addPool(abc,'multiname',value.base,cache);if(value.params)v.params=value.params.map(x=>addPool(abc,'multiname',x,cache));
  }
  pool.push(v);cache.set(id,pool.length-1);index.set(key(value),pool.length-1);return pool.length-1;
}
function encodePools(abc){
  const parts=[];
  for(const type of ['int','uint','double','string','namespace','nsset','multiname']){
    const values=abc.pools[type];parts.push(u30(values.length));
    for(let i=1;i<values.length;i++){
      const v=values[i];
      if(type==='int'||type==='uint'){
        let n=v>>>0;const bytes=[];do{const b=n&127;n>>>=7;bytes.push(b|(n?128:0));}while(n);parts.push(Buffer.from(bytes));
      }else if(type==='double')parts.push(Buffer.from(v,'hex'));
      else if(type==='string'){const b=Buffer.from(v);parts.push(u30(b.length),b);}
      else if(type==='namespace')parts.push(Buffer.from([v.kind]),u30(v.name));
      else if(type==='nsset')parts.push(u30(v.length),...v.map(u30));
      else {parts.push(Buffer.from([v.kind]));if(v.ns!==undefined)parts.push(u30(v.ns));if(v.name!==undefined)parts.push(u30(v.name));if(v.set!==undefined)parts.push(u30(v.set));if(v.base!==undefined)parts.push(u30(v.base),u30(v.params.length),...v.params.map(u30));}
    }
  }
  return Buffer.concat(parts);
}
function resolveArg(abc,v,locals,extra,cache){
  if(v&&typeof v==='object'){
    if(v.pool)return addPool(abc,v.pool,v.value,cache);
    if(v.local!==undefined){const n=locals[v.local];if(n===undefined)fail('寄存器映射缺失');return n;}
    if(v.extra!==undefined)return extra+v.extra;
    if(v.method||v.class)fail('注入不能引入新方法或类');
  }
  return v;
}
function encodedInstruction(x,positions,index){
  const parts=[Buffer.from([x.op])];
  if(x.op>=12&&x.op<=26){const p=positions[x.args[0].label];if(p===undefined)fail('标签缺失');parts.push(s24(p-(positions[index]+4)));}
  else if(x.op===27){x.args.forEach((v,i)=>parts.push(i===1?u30(v):s24(positions[v.label]-positions[index])));}
  else if(x.op===36||x.op===101)parts.push(Buffer.from(x.args));
  else if(x.op===239)parts.push(Buffer.from([x.args[0]]),u30(x.args[1]),Buffer.from([x.args[2]]),u30(x.args[3]));
  else parts.push(...x.args.map(u30));
  return Buffer.concat(parts);
}
function assemble(instructions){
  const positions=[0];instructions.forEach((x,i)=>{let size;if(x.op>=12&&x.op<=26)size=4;else if(x.op===27)size=1+3+u30(x.args[1]).length+(x.args.length-2)*3;else if(x.op===36||x.op===101)size=2;else if(x.op===239)size=3+u30(x.args[1]).length+u30(x.args[3]).length;else size=1+x.args.reduce((n,v)=>n+u30(v).length,0);positions.push(positions[i]+size);});
  return {positions,bytes:Buffer.concat(instructions.map((x,i)=>encodedInstruction(x,positions,i)))};
}
function hookIndex(decoded){
  const matches=[];
  decoded.instructions.forEach((x,i)=>{if(x.op===79&&x.args[0]&&x.args[0].value&&x.args[0].value.name==='CalLastDmgByAttackEntity'&&x.args[1]===3){
    const a=decoded.instructions.slice(i-5,i);
    if(a.length===5&&a[0].op===98&&a[1].op===98&&a[1].args[0]===0&&a[2].op===102&&a[2].args[0].value.name==='damage'&&a[3].op===98&&a[4].op===96&&a[4].args[0].value.name==='skill')matches.push(i-5);
  }});
  if(matches.length!==1)fail('伤害应用挂点不唯一');return matches[0];
}
function makeRule(original,patched){
  const a=locate(original),b=locate(patched),n=normalize(a.abc,a.body),d=decode(b.body.code,b.abc);
  const anchor=hookIndex(n.decoded),end=hookIndex(d),added=end-anchor,catchStart=n.decoded.instructions.length+added;
  if(added<1||catchStart>=d.instructions.length||b.body.locals!==a.body.locals+1||b.body.exceptions.length!==a.body.exceptions.length+1)fail('模板差异不符合预期');
  function label(index){
    if(index>=anchor&&index<end)return {segment:'injection',index:index-anchor};
    if(index>=catchStart)return {segment:'catch',index:index-catchStart};
    return {segment:'original',index:index>=end?index-added:index};
  }
  function instruction(x){return {op:x.op,args:x.args.map((v,i)=>{
    if(v&&v.label!==undefined)return label(v.label);
    if(LOCAL_OPS.has(x.op)&&i===0||x.op===50||x.op===239&&i===2){
      if(v>=a.body.locals)return {extra:v-a.body.locals};const canonical=n.locals.get(v);if(canonical===undefined)fail('模板寄存器不在原方法');return {local:canonical};
    }
    return v;
  })};}
  const injection=d.instructions.slice(anchor,end).map(instruction),handler=d.instructions.slice(catchStart).map(instruction);
  const exception=b.body.exceptions[b.body.exceptions.length-1];
  const rule={schema_version:1,engine_version:ENGINE_VERSION,target:{class:'prefabs.controls.DamageControl',method:'onHurt'},fingerprint:n.fingerprint,
    anchor_index:anchor,added_locals:1,max_stack:Math.max(a.body.stack,b.body.stack),injection,handler,
    exception:{from:label(d.target(exception.from)),to:label(d.target(exception.to)),target:label(d.target(exception.target)),type:symbol(b.abc,'multiname',exception.type),name:symbol(b.abc,'multiname',exception.name)}};
  // Demonstrate that this compact symbolic rule reproduces the intended method.
  const actual=patch(original,rule),c=locate(actual),actualN=normalize(c.abc,c.body),expectedN=normalize(b.abc,b.body);
  if(actualN.fingerprint!==expectedN.fingerprint)fail('生成的符号规则与补丁方法不一致');
  return rule;
}
function patch(input,rule){
  if(!rule||rule.schema_version!==1||rule.engine_version!==ENGINE_VERSION||rule.target.class!=='prefabs.controls.DamageControl'||rule.target.method!=='onHurt'||typeof rule.fingerprint!=='string'||!/^[0-9a-f]{64}$/.test(rule.fingerprint)||rule.added_locals!==1||!Array.isArray(rule.injection)||rule.injection.length<1||rule.injection.length>2048||!Array.isArray(rule.handler)||rule.handler.length>32)fail('规则版本');
  const located=locate(input),{abc,body,tag,start}=located;
  requirePrivateBinding(abc,'prefabs.controls:DamageControl');
  const n=normalize(abc,body),anchor=hookIndex(n.decoded);
  if(n.fingerprint!==rule.fingerprint||anchor!==rule.anchor_index)fail('伤害方法结构已变化，停止自动适配');
  const original=n.decoded.instructions,insertCount=rule.injection.length,total=original.length+insertCount+rule.handler.length,cache=new Map();
  function label(v){
    if(!v||!Number.isInteger(v.index)||v.index<0)fail('规则标签');
    if(v.segment==='original'){if(v.index>original.length)fail('规则原标签');return v.index>=anchor?v.index+insertCount:v.index;}
    if(v.segment==='injection'){if(v.index>insertCount)fail('规则注入标签');return anchor+v.index;}
    if(v.segment==='catch'){if(v.index>rule.handler.length)fail('规则异常标签');return original.length+insertCount+v.index;}
    fail('规则标签类型');
  }
  function convert(x,isRule){
    if(!OPCODES[x.op])fail('规则指令');
    return {op:x.op,args:x.args.map(v=>{
      // Private namespace identity is its pool entry, not its printable name.
      // Original pool/method/class operands must retain their exact references.
      if(!isRule&&v&&v.originalIndex!==undefined)return v.originalIndex;
      if(v&&v.label!==undefined)return {label:v.label>anchor?v.label+insertCount:v.label};
      if(v&&v.segment)return {label:label(v)};
      if(v&&v.method){const matches=[];abc.methods.forEach((m,i)=>{if(key(methodSymbol(abc,i))===key(v.method))matches.push(i);});if(matches.length!==1)fail('方法引用不唯一');return matches[0];}
      if(v&&v.class){const matches=[];abc.instances.forEach((m,i)=>{if(key(classSymbol(abc,i))===key(v.class))matches.push(i);});if(matches.length!==1)fail('类引用不唯一');return matches[0];}
      return resolveArg(abc,v,n.actual,body.locals,cache);
    })};
  }
  const instructions=original.slice(0,anchor).map(x=>convert(x,false)).concat(rule.injection.map(x=>convert(x,true)),original.slice(anchor).map(x=>convert(x,false)),rule.handler.map(x=>convert(x,true)));
  if(instructions.length!==total)fail('规则指令数');
  const assembled=assemble(instructions),pos=assembled.positions;
  function oldOffset(offset){const i=n.decoded.target(offset);return pos[i>anchor?i+insertCount:i];}
  const exceptions=body.exceptions.map(e=>({...e,from:oldOffset(e.from),to:oldOffset(e.to),target:oldOffset(e.target)}));
  const e=rule.exception;if(!e||e.type!==null||e.name!==null)fail('异常规则');exceptions.push({from:pos[label(e.from)],to:pos[label(e.to)],target:pos[label(e.target)],type:0,name:0});
  exceptions.forEach(x=>{if(!(x.from>=0&&x.from<x.to&&x.to<=assembled.bytes.length&&x.target<assembled.bytes.length))fail('异常区间');});
  const replacement=Buffer.concat([u30(body.method),u30(Math.max(body.stack,rule.max_stack)),u30(body.locals+1),u30(body.scope),u30(body.maxScope),u30(assembled.bytes.length),assembled.bytes,u30(exceptions.length),...exceptions.map(e=>Buffer.concat([u30(e.from),u30(e.to),u30(e.target),u30(e.type),u30(e.name)])),body.traits.raw]);
  const changedABC=Buffer.concat([abc.bytes.slice(0,4),encodePools(abc),abc.bytes.slice(abc.poolEnd,body.start),replacement,abc.bytes.slice(body.end)]);
  const payload=Buffer.concat([input.slice(tag.payload,start),changedABC]);
  const header=Buffer.alloc(6);header.writeUInt16LE((tag.type<<6)|63);header.writeUInt32LE(payload.length,2);
  const output=Buffer.concat([input.slice(0,tag.start),header,payload,input.slice(tag.end)]);
  if(output.length>MAX)fail('输出过大');output.writeUInt32LE(output.length,4);
  // Parsing again detects malformed branches/pools/exception boundaries before output.
  const verified=locate(output);normalize(verified.abc,verified.body);
  return output;
}
function readBounded(path,limit){
  const fd=fs.openSync(path,'r');
  try{
    const stat=fs.fstatSync(fd);if(!stat.isFile()||stat.size<1||stat.size>limit)fail('输入文件大小');
    const bytes=Buffer.alloc(stat.size);let offset=0;
    while(offset<bytes.length){const n=fs.readSync(fd,bytes,offset,bytes.length-offset,null);if(n===0)fail('读取文件截断');offset+=n;}
    const extra=Buffer.alloc(1);if(fs.readSync(fd,extra,0,1,null)!==0)fail('读取时文件变大');return bytes;
  }finally{fs.closeSync(fd);}
}
module.exports={patch,ENGINE_VERSION,makeRule,_test:{Reader,parseABC,locate,normalize,decode,assemble,hash,u30}};
if(require.main===module){
  try{
    const args=process.argv.slice(2);
    if(args.length!==3)fail('用法：INPUT OUTPUT RULE');
    const input=readBounded(args[0],MAX);
    const rule=JSON.parse(readBounded(args[2],1000000).toString('utf8'));
    const output=patch(input,rule);fs.writeFileSync(args[1],output,{mode:0o600});
    process.stdout.write(JSON.stringify({engine_version:ENGINE_VERSION,source_hash:hash(input),result_hash:hash(output),result_bytes:output.length})+'\n');
  }catch(error){process.stderr.write('[error] '+String(error.message||error)+'\n');process.exitCode=1;}
}
