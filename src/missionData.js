// Mission definitions. Each mission is a list of steps run in order by missions.js.
//
// Step types:
//   message  { from, text }                         show a phone message
//   npc      { id, x, z, look, facing }              place a story character
//   removeNpc{ id }
//   goto     { x, z, r, label, onFoot }              reach a marker (onFoot: must not be in a car)
//   spawnVehicle { id, model, x, z, heading, color } put a car in the world for the mission
//   enter    { vehicle | vehicleType, label }        get into a mission car (or any car of a type)
//   drive    { x, z, r, label, vehicle, stop }       drive there (in the named mission car if given)
//   wanted   { level, label }                        raise the wanted level
//   loseWanted { label }                             wait until the wanted level is gone
//   timer    { seconds }                             fail if the following steps take too long
//   reward   { cash }                                mission passed
//
// Coordinates are world metres (see the full-screen map: x grows east, z grows south).

export const MARCO_LOOK = { skin: '#8d5a3b', shirt: '#f4d35e', jacket: '#3d348b', pants: '#2b2d42', shoes: '#111111', hair: '#111111' };

export const MISSIONS = [
  {
    id: 'first-run',
    title: 'First Run',
    giver: 'Marco',
    summary: 'Marco from Solano Customs needs a van delivered.',
    autoStart: 8, // starts by itself this many seconds into a new game
    steps: [
      { type: 'message', from: 'Marco', text: "Hey, it's Marco from Solano Customs. My delivery driver quit on me. Meet me at Palm Park and I'll make it worth your while." },
      { type: 'npc', id: 'marco', x: -100, z: 117.5, look: MARCO_LOOK, facing: Math.PI / 2 },
      { type: 'goto', x: -100, z: 120, r: 3.5, label: 'Meet Marco at Palm Park', onFoot: true },
      { type: 'spawnVehicle', id: 'van', model: 'van', x: -85.6, z: 122, heading: Math.PI, color: '#f8f9fa' },
      { type: 'message', from: 'Marco', text: "That's my van on the street. Keys are in it. Take it to my shop in Eastgate, and don't scratch it." },
      { type: 'enter', vehicle: 'van', label: 'Get in the Courier van' },
      { type: 'removeNpc', id: 'marco' },
      { type: 'drive', x: 200, z: 52, r: 6, vehicle: 'van', stop: true, label: 'Deliver the van to Solano Customs' },
      { type: 'message', from: 'Marco', text: 'Smooth. Here is your cut. Come by the shop if you want more work.' },
      { type: 'reward', cash: 500 },
    ],
  },
];
