const {test}=require('node:test');
const assert=require('node:assert/strict');
const vm=require('node:vm');
const fs=require('node:fs');
const source=fs.readFileSync('app/src/main/assets/native/hq-native.js','utf8');
function setup({origin='https://kenthegreat123.github.io',path='/1st-Rate-Parts-App/',frame=false,existingHQ,transport=true}={}) {
  const messages=[], queries=[];
  let allowed=false;
  const window={HQ:existingHQ,dispatchEvent(){},prompt(message,token){queries.push({message,token});return String(allowed);}};
  window.top=frame?{}:window;
  if(transport)window.__HqNativeTransport={postMessage(data){messages.push(JSON.parse(data));}};
  const context=vm.createContext({window,location:{origin,pathname:path},Event:class Event{}});
  vm.runInContext(source.replace('__HQ_TOKEN__','test-token'),context);
  return {window,messages,queries,context,setAllowed(v){allowed=v;}};
}
test('exact four methods; actions return undefined, permission returns synchronous boolean',()=>{
  const s=setup();const n=s.window.HQNative;
  assert.deepEqual(Object.keys(n).sort(),['isBubbleAllowed','openHcp','requestBubblePermission','stopBubble'].sort());
  assert.equal(n.openHcp(),undefined);assert.equal(n.stopBubble(),undefined);assert.equal(n.requestBubblePermission(),undefined);
  assert.deepEqual(s.messages.map(x=>x.method),['openHcp','stopBubble','requestBubblePermission']);
  assert.ok(s.messages.every(x=>x.token==='test-token'));
  assert.equal(n.isBubbleAllowed(),false);s.setAllowed(true);assert.equal(n.isBubbleAllowed(),true);
  assert.deepEqual(s.queries[0],{message:'hq-native:overlay-permission',token:'test-token'});
});
test('existing HQ fallback calls and sign-out map to exact native operations',()=>{
  const s=setup();const HQ=s.window.HQ;
  HQ.openHcp();HQ.bubble.stop();HQ.bubble.requestPermission();
  assert.equal(HQ.bubble.isAllowed(),false);
  assert.deepEqual(s.messages.map(x=>x.method),['openHcp','stopBubble','requestBubblePermission']);
});
test('third-party frames, foreign origins, other repositories and missing transport get no facade',()=>{
  for(const opts of [{frame:true},{origin:'https://evil.test'},{path:'/other-repo/'},{path:'/1st-Rate-Parts-App-evil/'},{transport:false}]) {
    const s=setup(opts);assert.equal(s.window.HQNative,undefined);assert.equal(s.window.HQ,undefined);assert.equal(s.messages.length,0);
  }
});
test('preserves an existing website HQ object; facade cannot be replaced',()=>{
  const original={custom:true};const s=setup({existingHQ:original});
  assert.equal(s.window.HQ,original);s.window.HQNative={};assert.equal(typeof s.window.HQNative.openHcp,'function');
});
