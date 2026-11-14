import test from "node:test";
import assert from "node:assert/strict";
import {paginateReleasedItems} from "./valo-catalogue";

for(const [count,page,length,hasMore] of [[45,1,20,true],[45,2,20,true],[45,3,5,false],
  [45,4,0,false],[40,2,20,false],[0,1,0,false]] as const){
  test(`fixed20-row catalogue contract: ${count} items, page${page}`,()=>{
    const fixtures=Array.from({length:count},(_,i)=>({id:String(i),slug:`fixture-${i}`,title:`Fixture ${i}`,type:"template",industry:"All industries",summary:"Pure pagination fixture, not published content"}));
    const result=paginateReleasedItems(fixtures,{page});
    assert.equal(result.page,page);assert.equal(result.total,count);assert.equal(result.items.length,length);
    assert.equal(result.page*20<result.total,hasMore);
    assert.deepEqual(result.items.map(i=>Number(i.id)),Array.from({length},(_,i)=>(page-1)*20+i));
  });
}
