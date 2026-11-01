import test from 'node:test';
import assert from 'node:assert/strict';
test('password session versions accept SQL numeric strings but reject stale or invalid versions',{skip:process.env.MV_INTEGRATION!=='1'},async()=>{
 const {sameAuthVersion}=await import('../passwords.js');
 for(const pair of [[0,'0'],['0',0],[3,'3'],['3',3],[3,3]])assert.equal(sameAuthVersion(...pair),true);
 for(const pair of [[0,1],['3',4],[null,0],['',0],[false,0],['3oops',3],[-1,-1],[undefined,0],['9007199254740992','9007199254740992']])assert.equal(sameAuthVersion(...pair),false);
});