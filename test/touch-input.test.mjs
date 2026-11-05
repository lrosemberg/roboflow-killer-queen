import test from 'node:test';
import assert from 'node:assert/strict';
import { TouchInput } from '../public/touch-input.js';

const idle = { left: false, right: false, jump: false, action: false, down: false, dash: false };

test('stick uses a deadzone, clamps its visual radius and never jumps from upward motion', () => {
  const input = new TouchInput();
  assert.equal(input.pressStick(1,100,100,100,100,50),true);
  assert.deepEqual(input.snapshot(),idle);
  input.move(1,110,110);
  assert.deepEqual(input.snapshot(),idle,'Small thumb drift must not move the player');
  input.move(1,175,100);
  assert.deepEqual(input.stick,{active:true,pointerId:1,x:1,y:0});
  assert.deepEqual(input.snapshot(),{...idle,right:true});
  input.move(1,50,100);
  assert.deepEqual(input.snapshot(),{...idle,left:true});
  input.move(1,100,0);
  assert.deepEqual(input.snapshot(),idle,'Flying requires the dedicated jump button');
  input.move(1,200,200);
  assert.ok(Math.abs(Math.hypot(input.stick.x,input.stick.y)-1)<1e-12);
  assert.deepEqual(input.snapshot(),{...idle,right:true});
});

test('horizontal thumb drift does not drop through platforms; a deliberate downward diagonal does', () => {
  const input = new TouchInput();
  input.pressStick(1,48,15,0,0,50);
  input.pressButton(2,'jump');
  assert.deepEqual(input.snapshot(),{...idle,right:true,jump:true},'Slight downward drift must not cancel a moving jump');
  input.move(1,25,45);
  assert.deepEqual(input.snapshot(),{...idle,right:true,jump:true,down:true},'A predominantly downward pull still supports moving while dropping');
  input.move(1,0,20);
  assert.deepEqual(input.snapshot(),{...idle,jump:true},'Down has a deliberate travel threshold');
});

test('a second stick finger cannot take control or cancel the original finger', () => {
  const input = new TouchInput();
  input.pressStick(1,50,0,0,0,50);
  assert.equal(input.pressStick(2,-50,0,0,0,50),false);
  assert.equal(input.move(2,-50,0),false);
  assert.equal(input.release(2),false);
  assert.equal(input.snapshot().right,true);
  assert.equal(input.release(1),true);
  assert.deepEqual(input.snapshot(),idle);
  assert.deepEqual(input.stick,{active:false,pointerId:null,x:0,y:0});
  assert.equal(input.pressStick(2,-50,0,0,0,50),true);
  assert.equal(input.snapshot().left,true);
});

test('moving, holding flight and interacting use independent fingers with independent release', () => {
  const input = new TouchInput();
  input.pressStick(10,50,0,0,0,50);
  assert.equal(input.pressButton(11,'jump'),true);
  assert.equal(input.pressButton(12,'action'),true);
  assert.deepEqual(input.snapshot(),{...idle,right:true,jump:true,action:true});
  assert.equal(input.move(11,-100,100),false,'A button finger cannot steer the stick');
  input.release(11);
  assert.deepEqual(input.snapshot(),{...idle,right:true,action:true});
  input.release(10);
  assert.deepEqual(input.snapshot(),{...idle,action:true});
  input.release(12);
  assert.deepEqual(input.snapshot(),idle);
});

test('overlapping fingers on the same button keep it pressed until all sources end', () => {
  const input = new TouchInput();
  input.pressButton(1,'jump'); input.pressButton(2,'jump');
  assert.equal(input.pressButton(1,'action'),false,'An existing pointer keeps its original action');
  assert.equal(input.pressStick(1,0,0,0,0,50),false,'One finger cannot own both a button and the stick');
  assert.equal(input.release(1),true);
  assert.deepEqual(input.snapshot(),{...idle,jump:true});
  input.release(2);
  assert.deepEqual(input.snapshot(),idle);
  assert.equal(input.release(2),false,'Repeated pointerup/cancel is harmless');
});

test('down combines stick and button sources without one release cancelling the other', () => {
  const input = new TouchInput();
  input.pressStick(1,0,50,0,0,50); input.pressButton(2,'down');
  input.move(1,0,-50);
  assert.deepEqual(input.snapshot(),{...idle,down:true},'Down button still holds while the stick points up');
  input.move(1,0,50); input.release(2);
  assert.deepEqual(input.snapshot(),{...idle,down:true},'Stick down survives releasing its matching button');
  input.release(1);
  assert.deepEqual(input.snapshot(),idle);
});

test('reset on blur, round transition or hidden controls clears every held source', () => {
  const input = new TouchInput();
  input.pressStick(1,-50,50,0,0,50);
  input.pressButton(2,'jump'); input.pressButton(3,'action'); input.pressButton(4,'down');
  input.reset();
  assert.deepEqual(input.snapshot(),idle);
  assert.deepEqual(input.stick,{active:false,pointerId:null,x:0,y:0});
  assert.equal(input.move(1,50,0),false);
  for (const pointer of [1,2,3,4]) assert.equal(input.release(pointer),false);
  assert.equal(input.pressButton(2,'jump'),true,'Reused browser pointer IDs work after reset');
  assert.equal(input.snapshot().jump,true);
});

test('invalid presses do not acquire controls and exported state cannot mutate held inputs', () => {
  const input = new TouchInput();
  assert.equal(input.pressStick(1,0,0,0,0,0),false);
  assert.equal(input.pressStick(1,NaN,0,0,0,50),false);
  assert.equal(input.pressButton(2,'dash'),false,'Touch only exposes the same selected actions as keyboard controls');
  assert.equal(input.pressButton(undefined,'jump'),false);
  assert.equal(input.pressStick(1,50,0,0,0,50),true);
  assert.equal(input.move(1,Infinity,0),false);
  const stick = input.stick, snapshot = input.snapshot();
  stick.x = -1; snapshot.right = false; snapshot.jump = true;
  assert.deepEqual(input.snapshot(),{...idle,right:true});
  assert.equal(input.stick.x,1);
});
