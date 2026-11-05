import test from 'node:test';
import assert from 'node:assert/strict';
import { bindPageGestureGuard } from '../public/gesture-guard.js';

function fixture() {
  const target = new EventTarget(), destroy = bindPageGestureGuard(target);
  const point = (x = 50, y = 50, id = 1) => ({ identifier: id, clientX: x, clientY: y });
  const fire = (type, time, touches = [], changedTouches = touches) => {
    const event = new Event(type, { cancelable: true });
    Object.defineProperties(event, { timeStamp: { value: time }, touches: { value: touches }, changedTouches: { value: changedTouches } });
    target.dispatchEvent(event); return event.defaultPrevented;
  };
  const tap = (time, x = 50) => { fire('touchstart', time, [point(x)]); return fire('touchend', time + 30, [], [point(x)]); };
  return { target, destroy, point, fire, tap };
}

test('a normal tap remains native; a nearby second tap cannot zoom; distant/slower taps remain native', () => {
  const f = fixture();
  assert.equal(f.tap(0), false); assert.equal(f.tap(150, 58), true);
  assert.equal(f.tap(400), false); assert.equal(f.tap(550, 110), false);
  assert.equal(f.tap(1000, 110), false);
  assert.equal(f.fire('dblclick', 1200), true);
  f.destroy(); assert.equal(f.fire('dblclick', 1400), false);
});

test('single-finger scrolling remains native while pinch is prevented and cancels tap history', () => {
  const f = fixture();
  f.tap(0); f.fire('touchstart', 100, [f.point()]);
  assert.equal(f.fire('touchmove', 120, [f.point(50, 90)]), false);
  assert.equal(f.fire('touchend', 150, [], [f.point(50, 90)]), false);
  assert.equal(f.tap(200), false);
  assert.equal(f.fire('touchstart', 250, [f.point(), f.point(80, 80, 2)]), true);
  assert.equal(f.fire('touchmove', 260, [f.point(), f.point(120, 120, 2)]), true);
  f.fire('touchend', 270, [], [f.point(), f.point(80, 80, 2)]);
  assert.equal(f.tap(300), false);
  f.fire('touchcancel', 350); assert.equal(f.tap(400), false);
});

test('long holds and movement without touchmove cannot be mistaken for a second tap', () => {
  const f = fixture(); f.tap(0);
  f.fire('touchstart', 100, [f.point()]); assert.equal(f.fire('touchend', 500, [], [f.point()]), false);
  assert.equal(f.tap(550), false);
  f.fire('touchstart', 650, [f.point()]); assert.equal(f.fire('touchend', 680, [], [f.point(90)]), false);
  assert.equal(f.tap(700), false);
});

test('Safari gestures and trackpad pinch cannot zoom before or after joining a room', () => {
  const f = fixture();
  for(const type of ['gesturestart','gesturechange','gestureend'])assert.equal(f.fire(type,0),true);
  const normalWheel=new Event('wheel',{cancelable:true});f.target.dispatchEvent(normalWheel);assert.equal(normalWheel.defaultPrevented,false);
  const pinchWheel=new Event('wheel',{cancelable:true});Object.defineProperty(pinchWheel,'ctrlKey',{value:true});f.target.dispatchEvent(pinchWheel);assert.equal(pinchWheel.defaultPrevented,true);
  let controlEvents=0;f.target.addEventListener('touchstart',()=>controlEvents++);
  assert.equal(f.fire('touchstart',100,[f.point(),f.point(80,80,2)]),true);
  assert.equal(controlEvents,1,'zoom guard must not stop controls receiving either finger');
  f.destroy();for(const type of ['gesturestart','gesturechange','gestureend'])assert.equal(f.fire(type,200),false);
});
