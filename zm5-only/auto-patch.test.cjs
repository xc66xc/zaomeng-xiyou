'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const {patch,ENGINE_VERSION,_test:{locate,normalize,u30}}=require('./auto-patch.cjs');
const B=Buffer.from;
function join(...parts){return Buffer.concat(parts);}
function fixture(options={}){
  const shift=options.poolShift||0;
  const strings=['prefabs.controls','DamageControl','prefabs.controls:DamageControl','onHurt','damage','skill','CalLastDmgByAttackEntity','void',''];
  if(shift)strings.unshift('unrelated-compiler-entry');
  const extraName=(options.duplicatePrivate||options.duplicateQName)?1:0;
  const S=n=>n+shift,N=n=>n+shift+extraName;
  const stringsPool=join(u30(strings.length+1),...strings.map(s=>join(u30(Buffer.byteLength(s)),B(s))));
  const privateNS=options.duplicatePrivate?3:2,publicNS=options.duplicatePrivate?4:3;
  const ns=options.duplicatePrivate?join(u30(5),B([22]),u30(S(1)),B([5]),u30(S(3)),B([5]),u30(S(3)),B([22]),u30(S(9))):join(u30(4),B([22]),u30(S(1)),B([5]),u30(S(3)),B([22]),u30(S(9)));
  const names=[join(B([7]),u30(1),u30(S(2))),join(B([7]),u30(privateNS),u30(S(4))),join(B([7]),u30(privateNS),u30(S(5))),join(B([7]),u30(privateNS),u30(S(6))),join(B([7]),u30(publicNS),u30(S(7))),join(B([7]),u30(publicNS),u30(S(8)))];
  if(extraName)names.unshift(join(B([7]),u30(2),u30(S(5))));
  if(shift)names.unshift(join(B([7]),u30(3),u30(1)));
  const pool=join(u30(0),u30(0),u30(0),stringsPool,ns,u30(0),u30(names.length+1),...names);
  const methods=join(u30(1),u30(2),u30(N(6)),u30(0),u30(0),u30(S(4)),B([0]));
  const inst=join(u30(1),u30(N(1)),u30(0),B([0]),u30(0),u30(0),u30(1),u30(N(2)),B([1]),u30(0),u30(0));
  const klass=join(u30(0),u30(0));
  const local=options.localShift?{a:5,t:3}:{a:3,t:4};
  // A conditional branch ends exactly at the insertion anchor.
  const prefix=options.switch?B([0x24,0,0x1b,8,0,0,0,8,0,0]):join(B([0x20,0x12]),B([0,0,0]));
  const code=join(prefix,B([0x62]),u30(local.a),B([0xd0,0x66]),u30(N(3)),B([0x62]),u30(local.t),B([0x60]),u30(N(4)),B([0x4f]),u30(N(5)),u30(3),B([0x47]));
  const exceptions=options.exception?join(u30(1),u30(0),u30(code.length-1),u30(code.length-1),u30(0),u30(0)):u30(0);
  const body=join(u30(1),u30(0),u30(8),u30(6),u30(0),u30(1),u30(code.length),code,exceptions,u30(0));
  const abc=join(B([16,0,46,0]),pool,methods,u30(0),inst,klass,u30(0),body);
  const payload=join(B([0,0,0,0,0]),abc),tag=Buffer.alloc(6);tag.writeUInt16LE((82<<6)|63);tag.writeUInt32LE(payload.length,2);
  const swf=join(B('FWS'),B([17]),B([0,0,0,0]),B([8,0,0,0,1,0]),tag,payload,B([0,0]));swf.writeUInt32LE(swf.length,4);return swf;
}
function ruleFor(input){
  const x=locate(input),n=normalize(x.abc,x.body);
  return {schema_version:1,engine_version:ENGINE_VERSION,target:{class:'prefabs.controls.DamageControl',method:'onHurt'},fingerprint:n.fingerprint,anchor_index:2,added_locals:1,max_stack:8,
    injection:[{op:36,args:[0]},{op:41,args:[]}],handler:[{op:41,args:[]},{op:71,args:[]}],
    exception:{from:{segment:'injection',index:0},to:{segment:'original',index:2},target:{segment:'catch',index:0},type:null,name:null}};
}
test('generic patch accepts pool and local register relocations without version rules',()=>{
  const a=fixture(),rule=ruleFor(a);
  for(const options of [{},{poolShift:1},{localShift:true},{poolShift:1,localShift:true}]){
    const input=fixture(options),before=locate(input),output=patch(input,rule),after=locate(output);
    assert.equal(normalize(before.abc,before.body).fingerprint,rule.fingerprint);
    assert.equal(after.body.locals,before.body.locals+1);
    assert.equal(after.body.exceptions.length,1);
    const decoded=normalize(after.abc,after.body).decoded.instructions;
    assert.equal(decoded[1].args[0].label,2,'branch entering the hook must run the injection');
    assert.deepEqual(before.abc.methods,after.abc.methods);
    assert.equal(after.body.code[5],36);assert.equal(output.readUInt32LE(4),output.length);
    assert.throws(()=>patch(output,rule),/结构已变化/,'already patched files are never double-patched');
  }
});
test('changed damage instructions, malformed input and ambiguous class fail closed',()=>{
  const a=fixture(),rule=ruleFor(a),x=locate(a),bad=Buffer.from(a);
  const offset=a.indexOf(x.body.code,x.start);assert(offset>=0);bad[offset]=0x21;
  assert.throws(()=>patch(bad,rule),/结构已变化/);
  for(const b of [a.subarray(0,a.length-1),Buffer.alloc(0),Buffer.alloc(32000001)])assert.throws(()=>patch(b,rule));
  const duplicate=join(a.subarray(0,a.length-2),a.subarray(14,a.length-2),B([0,0]));duplicate.writeUInt32LE(duplicate.length,4);
  assert.throws(()=>patch(duplicate,rule),/唯一伤害方法/);
  assert.throws(()=>patch(a,{...rule,engine_version:'unknown'}),/规则版本/);
});

test('original exception boundaries relocate while new handler is appended',()=>{
 const input=fixture({exception:true}),before=locate(input),output=patch(input,ruleFor(input)),after=locate(output);
 const old=before.body.exceptions[0],changed=after.body.exceptions[0];
 assert.equal(after.body.exceptions.length,2);assert.equal(changed.from,old.from);
 // Injection adds three bytes; canonical getlocal0 encoding adds one.
 assert.equal(changed.to,old.to+4);assert.equal(changed.target,old.target+4);
 assert.equal(after.body.code[changed.target],71);
 assert.equal(after.body.exceptions[1].target,after.body.code.length-2);
});

test('lookupswitch targets remain instruction-aligned at the insertion boundary',()=>{
 const input=fixture({switch:true}),output=patch(input,ruleFor(input)),x=locate(output),code=normalize(x.abc,x.body).decoded.instructions;
 assert.equal(code[1].op,27);assert.equal(code[1].args[0].label,2);assert.equal(code[1].args[2].label,2);
});

test('CLI rejects oversized input before allocation and never creates an output',()=>{
 const fs=require('fs'),os=require('os'),path=require('path'),{spawnSync}=require('child_process');
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'zmxy-engine-test-'));
 try{
  const input=path.join(dir,'input.swf'),output=path.join(dir,'out.swf'),rule=path.join(dir,'rule.json');
  const fd=fs.openSync(input,'w');fs.ftruncateSync(fd,32000001);fs.closeSync(fd);fs.writeFileSync(rule,JSON.stringify(ruleFor(fixture())));
  const run=spawnSync(process.execPath,[path.join(__dirname,'auto-patch.cjs'),input,output,rule],{encoding:'utf8'});
  assert.equal(run.status,1);assert.match(run.stderr,/输入文件大小/);assert.equal(fs.existsSync(output),false);
 }finally{fs.rmSync(dir,{recursive:true,force:true});}
});

test('same-name private namespace identities are ambiguous and cannot redirect damage binding',()=>{
 const baseline=fixture(),input=fixture({duplicatePrivate:true}),before=locate(input);
 assert.equal(normalize(before.abc,before.body).fingerprint,ruleFor(baseline).fingerprint,'printed names alone deliberately cannot distinguish private identities');
 const damage=normalize(before.abc,before.body).decoded.instructions.find(x=>x.op===102);
 assert.equal(damage.args[0].originalIndex,4);
 assert.equal(before.abc.pools.multiname[4].ns,3);
 assert.equal(before.abc.pools.multiname[1].ns,2);
 assert.throws(()=>patch(input,ruleFor(baseline)),/私有命名空间不唯一/);
});

test('original constant operands retain their exact pool indexes even with equal printable QNames',()=>{
 const input=fixture({duplicateQName:true}),before=locate(input),output=patch(input,ruleFor(fixture())),after=locate(output);
 const original=normalize(before.abc,before.body).decoded.instructions.find(x=>x.op===102),changed=normalize(after.abc,after.body).decoded.instructions.find(x=>x.op===102);
 assert.equal(original.args[0].originalIndex,4);assert.equal(changed.args[0].originalIndex,4);
 assert.equal(Object.keys(changed.args[0]).includes('originalIndex'),false,'raw indexes do not enter fingerprints or serialized rules');
});
