'use strict';
const path=require('path');
const crypto=require('crypto');

async function readBounded(fs,home,name,limit) {
  const file=await fs.open(path.join(home,name),'r');
  try {
    const stat=await file.stat();
    if(!stat.isFile()||!Number.isSafeInteger(stat.size)||stat.size<1||stat.size>limit)throw new Error('文件大小不符');
    const buffer=Buffer.alloc(stat.size+1);
    let cursor=0;
    while(cursor<buffer.length) {
      const result=await file.read(buffer,cursor,buffer.length-cursor,cursor);
      if(!result.bytesRead)break;
      cursor+=result.bytesRead;
    }
    if(cursor!==stat.size)throw new Error('文件在读取期间发生变化');
    return buffer.slice(0,cursor);
  } finally {await file.close();}
}

function autoGameURL(value) {
  if(typeof value!=='string'||value.length>256)return false;
  const prefix='https://sda.4399.com/4399swf/upload_swf/ftp22/csya/20170622/1/';
  return value.startsWith(prefix)&&/^v[0-9]{1,12}\.swf$/.test(value.slice(prefix.length));
}

async function loadManifest(fs,home) {
  let bytes;
  try {bytes=await readBounded(fs,home,'auto-zm5.json',8192);}
  catch(error) {if(error.code==='ENOENT')throw new Error('尚无自动适配记录，请先使用新版助手接入造梦5。');throw error;}
  const manifest=JSON.parse(bytes.toString('utf8'));
  const hash=value=>typeof value==='string'&&/^[a-f0-9]{64}$/.test(value);
  if(!manifest||manifest.schema_version!==1||manifest.game!=='zm5'||manifest.protocol!=='zm5-attack-1.2'||
      manifest.engine_version!=='1'||!autoGameURL(manifest.game_url)||
      !hash(manifest.source_hash)||!hash(manifest.result_hash))throw new Error('自动适配记录不兼容');
  return manifest;
}

function verifyPatch(patch,resultHash) {
  if(patch.length<8||patch.length>32_000_000||patch.toString('ascii',0,3)!=='FWS'||
      patch.readUInt32LE(4)!==patch.length||crypto.createHash('sha256').update(patch).digest('hex')!==resultHash) {
    throw new Error('造梦5自动补丁校验失败，请保存并退出游戏后重新接入。');
  }
}

module.exports={readBounded,loadManifest,verifyPatch};
