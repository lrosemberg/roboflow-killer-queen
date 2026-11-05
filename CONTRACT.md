# Miami Mayhem integration contract

Node ESM server, vanilla browser ESM and Canvas2D. Default `PORT=8787`, bind `0.0.0.0`; static `public/` and `/shared/`. `ws` is the runtime dependency; `railway` is a development-only infrastructure SDK. The authoritative server runs 60 Hz simulation and 20 Hz snapshots, caches shared JSON fragments, keeps one snapshot in flight per socket, and culls distant players/loose chips in XXL.

## Room and role lifecycle

Classic has 10 total player slots; XXL has 120. Bots count toward slots and Queen quotas. Team assignment balances humans. A waiting lobby allows human Queen/Worker choices, team changes within per-side capacity, and host bot-count changes. Each side must have at least one participant before starting. Only the current leader can start; disconnecting transfers leadership. The quota is `ceil(teamPlayerCount / 5)`, zero for an empty team. Bots fill vacant Queen slots; humans cannot take an occupied human slot. All required slots must be assigned before host start.

Starting a round freezes Queen quotas and gives each assigned Queen three individual lives. The room becomes `playing` immediately with `startsAt = now + 3000`; all movement, bots, resources, gates, combat and gator motion remain frozen until that timestamp. Inputs received before GO are acknowledged but their buttons are discarded. Spawn protection expires 1800 ms after GO. An eliminated Queen remains out until the next round. Late joins and bot-controller replacements cannot refill lives or reset a Queen’s position, death/respawn or invulnerability. A departing Queen’s body can pass to a teammate; a Queen slot without a replacement is forfeited. Roles and bot counts are locked during a round. Worker→Warrior progression requires an AI1 station; Warrior death returns to Worker. Host rematch resets to `waiting`, allowing choices before another explicit start.

## WebSocket JSON protocol (`/ws`)

Browsers negotiate `/ws?protocol=compact-v1`. Compact `state` packets carry `encoding:"compact-v1"` and player tuples in the stable `PLAYER_FIELDS` order exported by `/shared/protocol.js`; clients call `decodeSnapshot()` before using the state. The schema includes all 34 public player fields. `joined` and control packets remain ordinary objects. Missing or unknown protocol queries use legacy object snapshots. A crowded 120-visible-player regression reduced an identical frame from 59,690 to 19,754 bytes before compression, while preserving field parity.

Client messages:

- `create`: `{type:'create',name,roomName,mode:'normal'|'xxl',private,botCount,botDifficulty:'easy'|'normal'|'hard',role:'queen'|'worker'}`. Legacy `bots:boolean` is accepted when `botCount` is absent.
- `join`: `{type:'join',code,name,role?}`; `quick`: `{type:'quick',name,mode,role?,botDifficulty?}` (difficulty applies if a new room is created).
- `input`: `{type:'input',seq,left,right,jump,action,dash,down}`. Sequence must be a nonnegative safe integer newer than the acknowledged input. `dash` means airborne Queen dive; other roles have no generic dash.
- `role`: `{type:'role',role:'queen'|'worker'}` in `waiting`/`ended` only.
- `team`: `{type:'team',team:0|1}` in `waiting` only. A full side can yield a bot seat; humans are never evicted.
- `bots`: `{type:'bots',count}` from host between rounds only.
- `bot-difficulty`: `{type:'bot-difficulty',difficulty:'easy'|'normal'|'hard'}` from host between rounds only. Default is `normal`; difficulty changes tactical cadence and pressure, never physical movement, lives, or resources.
- `start`, `rematch`, `leave`; `ping` with `time`; `emote` with `emoji:'GG'|'HEY'|'LOL'`.

Server messages:

- `welcome`: `{type:'welcome',id}`.
- `rooms`: public room summaries with `code,name,mode,players,bots,botDifficulty,maxPlayers,status,private`.
- `joined`: `{type:'joined',id,code,hostId,map,room:{name,mode,maxPlayers,private,botTarget,botDifficulty},players}`.
- `state`: `{type:'state',time,tick,ack,players,berries,piles,gates,gator,scores,scoreTarget,resourceCount,economyPlayerCount,queenLives,queenQuota,queensRemaining,status,startsAt,countdownUntil,winner,winType,winReason,victory,events,playerCount,botCount,configuredBots,botDifficulty,hostId,elapsedSeconds,remaining:null,lobbyPlayers?}`.
- `left`; `error` with `message`; `pong` echoing `time`.

`time` is server epoch milliseconds; animation/channel times use the same clock. The client estimates clock offset. `elapsedSeconds` freezes at victory and is zero in a waiting lobby. `startsAt` and `countdownUntil` are the same server epoch timestamp (zero in a waiting lobby); clients derive the opening 3–2–1–GO display from it. `remaining` is always `null`: no round-duration countdown or timeout winner exists.

`queenLives:[n,n]` is aggregate remaining lives. `queenQuota:[n,n]` is the authoritative slot count; `queensRemaining:[n,n]` counts Queen slots with at least one life. During active play, these include disconnected/forfeited slots correctly. `lobbyPlayers` contains a compact full roster (`id,name,team,role,bot`) only while waiting or ended; active XXL `players` is interest-culled. Physics fields are sent only in `players`, avoiding duplicate full-player data in a crowded lobby.

## World data

`map` contains `width,height,mode,platforms,bases,gates,berryPiles,berrySpawns,gatorTrack,scoreTarget,resourceCount,economyPlayerCount`. Positions of platforms/bases/gates are top-left. Economic capacity is proportional to the total human-plus-bot roster: `scoreTarget = ceil(12 * players / 10)` and `resourceCount = 6 * players` (empty configuration uses a one-chip target and six-chip stock). Full rooms need 12 chips per team for 10 players or 144 for 120; their total stock is 60 or 720. There are six supply piles in Classic and twelve in XXL. Waiting-roster changes refresh this configuration; countdown, active play and results freeze it until the next lobby. Snapshots repeat `scoreTarget`, `resourceCount` and `economyPlayerCount`; the client synchronizes its joined map before drawing HUD, vault cells or results. `SCORE_TARGETS` holds full-capacity defaults, not a live room target. Classic is a 1,440 × 820 arena shown in one fixed view; XXL remains a 12,000 × 2,000 scrolling world. `map.berryPile` is a compatibility alias for the first pile.

- Bases: `{x,y,w,h,team,door:{x,y,w,h}}`. Both HQs stand on platforms 540 world pixels above the ground. Deposits require the Worker to be grounded at the visible door.
- Gates: `{id,kind:'warrior'|'speed',x,y,w,h,team:null|0|1}`. Map gates start neutral; `state.gates` contains live ownership.
- Piles: `{id,x,y}` in the map; `{id,x,y,remaining}` in snapshots. Classic has four ground piles at x=560/660/780/880 and two on the central y=632 bridge at x=670/770. Mirrored zig-zag ledges rise in108px steps to the HQs. XXL distributes12piles through the central60% of the city, keeping a collection journey from either HQ.
- Internal berry stock: `{id,x,y,active,pileId}`. Initial stock has a pile ID. Carried/delivered/spent stock stays inactive; it never regenerates. A dropped chip becomes loose with `pileId:null`. **Snapshots contain only loose berries**; initial stock is represented by pile counts.
- Gator: `{x,y,riderId,progress}`, center coordinates, progress from −1 to 1.
- Events: `{id,type,x,y,team,text,actor?,target?,amount?,score?,scoreTarget?,gateKind?,upgradeKind?}` for visual/audio cues. Actor/target are identity snapshots `{id,name,team,bot}` so a feed entry still identifies someone after they leave view or disconnect. KO events identify killer and victim; pickup/deposit identify the collector with `amount:1`, and deposits also include the new score and target. Short `text` remains compatible with world effects. The room retains at most 80 events; authoritative outcomes persist in state even if a congested client misses an event.

Players have `id,name,team,role,x,y,vx,vy,facing,grounded,alive,respawnAt,carrying,bot,invulnerableUntil,attackUntil,emote,emoteUntil,score,kills,ack`, shared movement fields, and `queenLives,eliminated,speedBoost,dive,upgradeUntil,upgradeGateId,upgradeKind`. Player positions are top-left; dimensions are 28×36. `queenLives` is individual for Queens. `upgradeUntil` is zero outside a transformation; shared movement freezes until its server timestamp.

Team 0 is Roboflow purple (**Purple Pixels**); team 1 is coral (**Sunset Syndicate**).

## Authoritative objectives and progression

- Economic: a Worker deposits one carried chip while grounded on the friendly hive platform, with their horizontal center inside its visible door. Flying through the building does not deposit. Deposits are permanent. Reaching the round’s locked proportional target (12 for 10 total players, 144 for 120) ends the round immediately.
- Military: Queens and Warriors fight by directional close contact; height advantage decides opposing swords, equal-height swords clash, and Queens can dive. Each Queen loses one life per death. A team loses only after every assigned Queen has exhausted all three lives.
- Gator: only Workers can mount with action near the crocodile. It moves toward the rider’s own goal at half-track-distance/70 world pixels per second, multiplied by1.5 with a speed upgrade. An uninterrupted center-to-goal ride therefore takes70seconds normally or46.67seconds boosted; stolen rides retain their position. Jump dismounts. Reaching that goal ends the round.
- Machines: Queens claim stations by touching them. A Worker carrying one chip presses action inside a neutral/friendly station, then channels for 650 ms while stationary and vulnerable. Death or hostile capture cancels installation. Successful wing installation consumes the chip and grants Warrior flight; speed installation consumes it and grants faster movement/riding. Upgrades are lost on death.

`winType` is `economic`, `military`, `gator`, or `null`. Frozen `victory` is `{type,team,actorName,durationMs,data:[n,n],scoreTarget,economyPlayerCount,queenLives:[n,n],queenQuota:[n,n],queensRemaining:[n,n],gatorProgress}`. A winning transition is atomic: subsequent simulation work cannot alter its outcome. There is no score-based timeout winner.

Bot jobs cycle through runner/fighter/gator/fighter on Normal and Hard, and runner/fighter/gator/runner on Easy. Decision cadence and pressure vary by difficulty. A shared250ms room strategy plan assigns a bounded set of armed bots to interrupt dangerous enemy gator rides and near-win deliveries. Workers retain reachable jobs; last-life Queens prioritize survival. The plan selects targets only, without changing positions, physics, damage or lives. Worker steering uses the cached platform graph in `/shared/navigation.js` each physics tick; it supplies ordinary inputs and never corrects positions or grants extra movement abilities.

## Shared movement and renderer

`/shared/world.js` exports `PLAYER_W`, `PLAYER_H`, `SPEED`, `GRAVITY`, `JUMP_SPEED`, `SCORE_TARGETS`, `BOT_DIFFICULTIES`, `economyForPlayers(total)`, `configureMapEconomy(map,total)`, `createMap(mode, totalPlayers?)` and `movePlayer(player,input,map,dt,now)`. It contains deterministic map configuration and movement/collision; match actions remain server-owned. Workers have one jump, military roles can flap while jump is held, Queen down/dash inputs dive in the air, and speed requires a gate upgrade. No browser globals.

`Renderer` exports `constructor(canvas)`, `setMap(map)`, `setState(state,localId)`, `render(dt,localPlayerOverride?)` and `destroy()`. Classic fits the full arena into a fixed camera with a compact HUD (128 CSS px reserved above, 44 below). XXL follows the local player with a limited viewport. It uses live gate/pile state, and renders pixel Miami scenery, raccoons, AI1 machines, gator, effects and readable objectives. The vault shows the exact score/target and chips remaining, grouping larger targets into at most 36 cells; a partial final group fills against its actual capacity. The client owns RAF, networking, input, HUD, audio and reconciliation.

## Touch input

`/public/touch-input.js` exports the DOM-independent `TouchInput` model. `pressStick(pointerId,x,y,centerX,centerY,radius)`, `move(pointerId,x,y)`, `pressButton(pointerId,action)`, `release(pointerId)` and `reset()` track independent pointer ownership. `snapshot()` returns the existing movement/action booleans; valid buttons are `jump`, `action` and `down`. The right stick uses a dead zone and maps horizontal motion to left/right, downward motion to Queen dive/platform drop; the left buttons can be held simultaneously. No protocol or physics changes are needed.

The DOM adapter captures each pointer and composes touch with keyboard input. Cancellation, loss of capture, blur, hidden pages, dialogs and blocked gameplay states must release held touch inputs. Touch gesture suppression applies to the game controls; ordinary page and dialog scrolling stays available. Portrait guidance must preserve access to the menu and must not imply that a network match pauses. Fullscreen and landscape orientation locking are optional, feature-detected requests made after a user gesture; unsupported browsers retain manual-rotation play.

This is a themed adaptation of the [Killer Queen Arcade role and victory foundation](https://www.killerqueenarcade.com/howtoplay). XXL, proportional multi-Queen teams, custom maps/physics, held-button flight, automatic HQ deposits and lack of screen wrapping are intentional differences from the cabinet.
