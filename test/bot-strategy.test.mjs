import test from 'node:test';
import assert from 'node:assert/strict';
import WebSocket from 'ws';
import { createMap } from '../shared/world.js';
import { createBotStrategy, queenRetreatTarget, isQueenGateSafe } from '../shared/bot-strategy.js';
import { createGameServer } from '../server.js';

const player = (id, team, extra = {}) => ({ id, team, bot:true, botSeed:Number(id.replace(/\D/g,''))||1, alive:true, role:'warrior', queenLives:0, x:500, y:500, invulnerableUntil:0, ...extra });
const arena = (players, extra = {}) => {
  const map = createMap('normal');
  return { players:new Map(players.map(p=>[p.id,p])), map, scores:[0,0], gator:{x:map.width/2,riderId:null}, botDifficulty:'normal', ...extra };
};
const approach = (map, team, offset = 50) => ({ x:map.bases[team].x+map.bases[team].w/2-offset, y:map.bases[team].y+map.bases[team].h-36 });

test('near-win carriers are intercepted at their vault approach, with earlier warnings on Hard', () => {
  const map = createMap('normal');
  const defender = player('d1',0,{role:'queen',queenLives:3});
  const carrier = player('c1',1,{role:'worker',carrying:true,...approach(map,1)});
  const farCarrier = player('c2',1,{role:'worker',carrying:true,x:0,y:map.height-116});
  const room = arena([defender,carrier,farCarrier],{map,scores:[0,10]});
  assert.deepEqual(createBotStrategy(room,1000).defense.get(defender.id),{kind:'carrier',targetId:carrier.id});
  assert.equal(createBotStrategy({...room,botDifficulty:'easy'},1000).defense.size,0);
  room.scores[1]=11;
  assert.equal(createBotStrategy({...room,botDifficulty:'easy'},1000).defense.get(defender.id).targetId,carrier.id,'Even Easy reacts to the final delivery at 11/12');
  room.scores[1]=9;
  assert.equal(createBotStrategy(room,1000).defense.size,0);
  assert.equal(createBotStrategy({...room,botDifficulty:'hard'},1000).defense.get(defender.id).targetId,carrier.id);
  carrier.carrying=false;
  assert.equal(createBotStrategy({...room,botDifficulty:'hard'},1000).defense.size,0,'A distant collector is not hunted from across the map');
});

test('XXL gator defense uses bounded available fighters, never workers, humans, dead or last-life Queens', () => {
  const map = createMap('xxl'), half=(map.gatorTrack.x2-map.gatorTrack.x1)/2;
  const crew = Array.from({length:60},(_,i)=>player(`d${i}`,0,{x:1000+i*90}));
  Object.assign(crew[0],{bot:false}); Object.assign(crew[1],{role:'worker'});
  Object.assign(crew[2],{role:'queen',queenLives:1}); Object.assign(crew[3],{alive:false});
  const rider=player('r1',1,{role:'worker',x:map.width/2+half*.9,y:map.gatorTrack.y-58});
  const room=arena([...crew,rider],{map,gator:{x:rider.x,riderId:rider.id}});
  const before=JSON.stringify([...room.players.values()]);
  for (const [difficulty,cap] of [['easy',2],['normal',4],['hard',6]]) {
    const plan=createBotStrategy({...room,botDifficulty:difficulty},1000);
    assert.equal(plan.defense.size,cap);
    for (const [id,assignment] of plan.defense) {
      assert.ok(!crew.slice(0,4).some(p=>p.id===id));
      assert.deepEqual(assignment,{kind:'gator',targetId:rider.id});
    }
  }
  assert.equal(JSON.stringify([...room.players.values()]),before,'Strategy changes no positions, speeds, lives or inventory');
  room.gator.x=map.width/2+half*.5;
  assert.equal(createBotStrategy(room,1000).defense.size,0);
  assert.equal(createBotStrategy({...room,botDifficulty:'hard'},1000).defense.size,6);
});

test('gator threat direction is symmetric and an approaching friendly rider never becomes a target', () => {
  const map=createMap('normal'), half=(map.gatorTrack.x2-map.gatorTrack.x1)/2;
  for (const riderTeam of [0,1]) {
    const rider=player('r1',riderTeam,{role:'worker',x:map.width/2+half*.9*(riderTeam===0?-1:1)});
    const friendly=player('d1',riderTeam),opponent=player('d2',1-riderTeam);
    const plan=createBotStrategy(arena([rider,friendly,opponent],{map,gator:{x:rider.x,riderId:rider.id}}),1000);
    assert.equal(plan.defense.has(friendly.id),false);
    assert.deepEqual(plan.defense.get(opponent.id),{kind:'gator',targetId:rider.id});
  }
});

test('a threatened human Queen receives a warrior bodyguard before a nearer healthy Queen is exposed', () => {
  const map=createMap(), home=approach(map,0,0);
  const queen=player('human-queen',0,{...home,bot:false,role:'queen',queenLives:1});
  const warrior=player('bodyguard',0,{x:home.x+330,y:home.y+140});
  const healthyQueen=player('support-queen',0,{x:home.x+90,y:home.y,role:'queen',queenLives:3});
  const worker=player('runner',0,{...home,role:'worker',carrying:true});
  const attacker=player('attacker',1,{x:home.x+170,y:home.y-30,role:'queen',queenLives:3});
  const plan=createBotStrategy(arena([queen,warrior,healthyQueen,worker,attacker],{map}),1000);
  assert.equal(plan.defense.size,1,'One small-team defender is enough; the rest keep their jobs');
  assert.deepEqual(plan.defense.get(warrior.id),{kind:'bodyguard',targetId:attacker.id,protectedId:queen.id});
  assert.equal(plan.defense.has(healthyQueen.id),false);
  assert.equal(plan.defense.has(worker.id),false);
  assert.equal(plan.jobs.has(worker.id),true);
});

test('Queen bodyguards share the same XXL defender budget and never select the Queen being protected', () => {
  const map=createMap('xxl');
  const queens=Array.from({length:12},(_,i)=>player(`q${i}`,0,{role:'queen',queenLives:2,x:600+i*650,y:500}));
  const warriors=Array.from({length:48},(_,i)=>player(`w${i}`,0,{x:650+i*140,y:520}));
  const attackers=queens.map((q,i)=>player(`enemy${i}`,1,{x:q.x+100,y:q.y-40}));
  const plan=createBotStrategy(arena([...queens,...warriors,...attackers],{map}),1000);
  assert.equal(plan.defense.size,4);
  for(const [id,assignment] of plan.defense){
    assert.ok(warriors.some(w=>w.id===id)); assert.equal(assignment.kind,'bodyguard');
    assert.notEqual(id,assignment.protectedId);
  }
});

test('last-life Queens choose an upward escape away from immediate attackers, including at walls', () => {
  const map=createMap(), queen=player('q1',0,{role:'queen',queenLives:1,x:500,y:600});
  const threat=player('e1',1,{x:550,y:570});
  const retreat=queenRetreatTarget(queen,[threat],map);
  assert.ok(retreat.x<queen.x); assert.ok(retreat.y<queen.y);
  queen.x=40;threat.x=80;
  const wallEscape=queenRetreatTarget(queen,[threat],map);
  assert.ok(wallEscape.x<=queen.x,'Do not reverse through the nearby attacker just to reach a distant endpoint');
  assert.ok(wallEscape.x>=0 && wallEscape.y>=0);
  assert.ok(queenRetreatTarget({...queen,queenLives:2},[threat],map),'Two remaining lives are already worth protecting');
  assert.equal(queenRetreatTarget({...queen,queenLives:3},[{...threat,y:queen.y+60}],map),null,'A healthy Queen retains fights with a height advantage');
  assert.equal(queenRetreatTarget(queen,[{...threat,role:'worker'}],map),null,'Harmless workers do not trigger panic');
});

test('Queens avoid contested gate traps but still claim clear gates and safe fights from above', () => {
  const map=createMap(), gate=map.gates[0], arrival={x:gate.x+gate.w/2,y:gate.y+25};
  const queen=player('q1',0,{role:'queen',queenLives:2});
  const armed=player('e1',1,{...arrival,y:arrival.y-30,role:'queen',queenLives:3});
  assert.equal(isQueenGateSafe(queen,gate,[armed]),false);
  assert.equal(isQueenGateSafe(queen,gate,[{...armed,role:'worker'}]),true);
  assert.equal(isQueenGateSafe(queen,gate,[{...armed,x:arrival.x+400}]),true);
  assert.equal(isQueenGateSafe({...queen,queenLives:3},gate,[{...armed,y:arrival.y+70}]),true);
  assert.equal(isQueenGateSafe(queen,gate,[{...armed,y:arrival.y+70}]),false,'An injured Queen does not repeatedly dive into a contested gate');
});

test('workers retain deterministic navigable jobs even while their teammates defend', () => {
  const roster=Array.from({length:8},(_,i)=>player(`w${i+1}`,0,{role:'worker',botSeed:i+1}));
  const normal=createBotStrategy(arena(roster),1000),easy=createBotStrategy(arena(roster,{botDifficulty:'easy'}),1000);
  assert.deepEqual([...normal.jobs.values()],['runner','fighter','gator','fighter','runner','fighter','gator','fighter']);
  assert.deepEqual([...easy.jobs.values()],['runner','fighter','gator','runner','runner','fighter','gator','runner']);
  assert.equal(normal.defense.size,0);
});

test('server bots act on defensive targets using ordinary movement instead of teleporting', async t => {
  const game=createGameServer({port:0,host:'127.0.0.1',countdownMs:0});
  const {port}=await game.listen(); t.after(()=>game.close());
  const socket=new WebSocket(`ws://127.0.0.1:${port}/ws`);
  let room;
  await new Promise((resolve,reject)=>{
    const timeout=setTimeout(()=>reject(new Error('Room setup timeout')),2500);
    socket.on('error',reject);
    socket.on('message',raw=>{
      const msg=JSON.parse(raw);
      if(msg.type==='welcome')socket.send(JSON.stringify({type:'create',private:true,botCount:9,role:'worker'}));
      if(msg.type==='joined'){room=game.rooms.get(msg.code);socket.send(JSON.stringify({type:'start'}));}
      if(msg.type==='state'&&msg.status==='playing'){clearTimeout(timeout);resolve();}
    });
  });
  for(const p of room.players.values()){p.nextThink=Date.now()+100000;p.botInput={};p.botTarget=null;p.invulnerableUntil=Date.now()+100000;}
  const defender=[...room.players.values()].find(p=>p.bot&&p.team===0&&p.role==='worker');
  const rider=[...room.players.values()].find(p=>p.team===1&&p.role==='worker');
  assert.ok(defender&&rider);
  const half=(room.map.gatorTrack.x2-room.map.gatorTrack.x1)/2;
  room.gator.x=room.map.width/2+half*.8; room.gator.riderId=rider.id;
  Object.assign(rider,{x:room.gator.x-14,y:room.gator.y-58,invulnerableUntil:0});
  Object.assign(defender,{role:'warrior',x:room.gator.x-200,y:room.map.height-116,vx:0,vy:0,grounded:true,invulnerableUntil:0,nextThink:0});
  room.botStrategy=null;
  const before=defender.x,timeout=Date.now()+1500;
  while(defender.x<=before){assert.ok(Date.now()<timeout,'Defender must start moving toward the enemy rider');await new Promise(resolve=>setTimeout(resolve,10));}
  assert.deepEqual(room.botStrategy.defense.get(defender.id),{kind:'gator',targetId:rider.id});
  assert.equal(defender.botInput.right,true); assert.equal(defender.vx,270);
  assert.ok(defender.x-before<20,'Only ordinary simulation steps advance the defender');
  assert.equal(defender.speedBoost,false);

  // A final-life Queen must not combine her upward escape with a dive toward
  // the enemy below her, even though that enemy remains a valid combat target.
  room.gator.riderId=null;
  Object.assign(defender,{role:'queen',queenLives:1,x:500,y:400,vx:0,vy:0,grounded:false,nextThink:0});
  Object.assign(rider,{role:'warrior',x:510,y:445,vx:0,vy:0,grounded:false});
  room.botStrategy=null;
  while(defender.nextThink===0){assert.ok(Date.now()<timeout);await new Promise(resolve=>setTimeout(resolve,10));}
  assert.equal(defender.botInput.jump,true); assert.equal(defender.botInput.down,false);
  assert.equal(room.botStrategy.defense.has(defender.id),false);
});
