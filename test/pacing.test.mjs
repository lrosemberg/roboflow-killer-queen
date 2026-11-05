import test from 'node:test';
import assert from 'node:assert/strict';
import WebSocket from 'ws';
import { createMap } from '../shared/world.js';
import { getGatorSpeed } from '../shared/pacing.js';
import { createGameServer } from '../server.js';

test('both gator tracks take 70 seconds from center, or 46.67 seconds with earned speed', () => {
  for (const mode of ['normal','xxl']) {
    const track=createMap(mode).gatorTrack, distance=(track.x2-track.x1)/2;
    assert.equal(distance/getGatorSpeed(track),70);
    assert.ok(Math.abs(distance/getGatorSpeed(track,true)-70/1.5)<1e-10);
    assert.equal(getGatorSpeed(track,true),getGatorSpeed(track)*1.5);
  }
});

test('gator pacing scales with changed routes and retains proportional return-trip time', () => {
  const track={x1:300,x2:1700}, speed=getGatorSpeed(track);
  assert.equal(speed,10);
  assert.equal((track.x2-track.x1)/speed,140,'Stealing a nearly completed opposing ride retains the longer return route');
});

test('authoritative gator motion follows the paced speed on Classic and XXL simulation ticks', async t => {
  for (const mode of ['normal','xxl']) await t.test(mode,async t => {
    const game=createGameServer({port:0,host:'127.0.0.1',countdownMs:0});
    const {port}=await game.listen();t.after(()=>game.close());
    const socket=new WebSocket(`ws://127.0.0.1:${port}/ws`);
    let room,id;
    await new Promise((resolve,reject)=>{
      const timeout=setTimeout(()=>reject(new Error('Room setup timeout')),2500);
      socket.on('error',reject);
      socket.on('message',raw=>{
        const msg=JSON.parse(raw);
        if(msg.type==='welcome'){id=msg.id;socket.send(JSON.stringify({type:'create',mode,private:true,botCount:3,role:'worker'}));}
        if(msg.type==='joined'){room=game.rooms.get(msg.code);socket.send(JSON.stringify({type:'start'}));}
        if(msg.type==='state'&&msg.status==='playing'){clearTimeout(timeout);resolve();}
      });
    });
    for(const p of room.players.values()){p.nextThink=Date.now()+100000;p.botInput={};p.botTarget=null;p.invulnerableUntil=Date.now()+100000;}
    const rider=room.players.get(id);room.gator.riderId=id;
    for(const boosted of [false,true]) {
      rider.speedBoost=boosted;
      const x=room.gator.x,tick=room.tick,timeout=Date.now()+1500;
      while(room.tick<tick+12){assert.ok(Date.now()<timeout);await new Promise(resolve=>setTimeout(resolve,10));}
      const expected=getGatorSpeed(room.map.gatorTrack,boosted)*(room.tick-tick)/60;
      assert.ok(Math.abs(Math.abs(room.gator.x-x)-expected)<1e-7);
      assert.equal(room.gator.riderId,id);assert.equal(room.status,'playing');
    }
  });
});
