// Mission definitions. Each mission is a list of steps run in order by missions.js.
//
// Step types:
//   message  { from, text }                         show a phone message
//   npc      { id, x, z, look, facing }              place a story character
//   removeNpc{ id }
//   goto     { x, z, r, label, onFoot }              reach a marker (onFoot: must not be in a car)
//   spawnVehicle { id, model, x, z, heading, color } put a car in the world for the mission
//   enter    { vehicle | vehicleType, x, z, label }  get into a mission car (or any car of a type;
//                                                    x, z mark where to find one)
//   drive    { x, z, r, label, vehicle | vehicleType, stop }
//                                                    drive there (in the named mission car or a car of that type)
//   wanted   { level, label }                        raise the wanted level
//   loseWanted { label }                             wait until the wanted level is gone
//   checkpoints { points: [[x, z], ...], r, label, vehicle | vehicleType }
//                                                    drive through each point in order
//   timer    { seconds }                             fail if the following steps take too long
//   reward   { cash, par, bonus }                    mission passed; finishing within par seconds
//                                                    of the start pays the bonus too
//
// Any step can have checkpoint: true. Reaching it saves a restart point, and after a
// failure the player can press R to retry from there. Each checkpoint in a
// checkpoints step also saves one.
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
    where: 'Starts with a phone call',
    steps: [
      { type: 'message', from: 'Marco', text: "Hey, it's Marco from Solano Customs. My delivery driver quit on me. Meet me at Palm Park and I'll make it worth your while." },
      { type: 'npc', id: 'marco', x: -100, z: 117.5, look: MARCO_LOOK, facing: Math.PI / 2 },
      { type: 'goto', x: -100, z: 120, r: 3.5, label: 'Meet Marco at Palm Park', onFoot: true },
      { type: 'spawnVehicle', id: 'van', model: 'van', x: -85.6, z: 122, heading: Math.PI, color: '#f8f9fa' },
      { type: 'message', from: 'Marco', text: "That's my van on the street. Keys are in it. Take it to my shop in Eastgate, and don't scratch it." },
      { type: 'enter', vehicle: 'van', label: 'Get in the Courier van' },
      { type: 'removeNpc', id: 'marco' },
      { type: 'message', from: 'Marco', text: 'Cops are stopping vans on 2nd St. Take 3rd St across town and follow my route.' },
      {
        type: 'checkpoints', vehicle: 'van', r: 8, label: "Follow Marco's route", checkpoint: true,
        points: [[-80, 84], [0, 78], [80, 78], [160, 78]],
      },
      { type: 'drive', x: 200, z: 52, r: 6, vehicle: 'van', stop: true, label: 'Deliver the van to Solano Customs', checkpoint: true },
      { type: 'message', from: 'Marco', text: 'Smooth. Here is your cut. Come by the shop if you want more work.' },
      { type: 'reward', cash: 500, par: 150, bonus: 150 },
    ],
  },
  {
    id: 'hot-property',
    title: 'Hot Property',
    giver: 'Marco',
    summary: 'Steal a police cruiser for a collector and get it to the docks.',
    requires: ['first-run'],
    start: { x: 182, z: 37 },
    where: 'outside Solano Customs, Eastgate',
    steps: [
      { type: 'message', from: 'Marco', text: 'A collector wants a real Patrol Cruiser. There are always a few parked behind the Police Station. Bring me one.' },
      { type: 'enter', vehicleType: 'police', x: 112, z: -100, label: 'Steal a Patrol Cruiser from the Police Station' },
      { type: 'message', from: 'Marco', text: "They will be after you. Shake them off before you come anywhere near the docks." },
      { type: 'loseWanted', label: 'Lose the police' },
      { type: 'drive', x: 290, z: 432, r: 8, vehicleType: 'police', stop: true, label: 'Deliver the cruiser to the Port Docks', checkpoint: true },
      { type: 'message', from: 'Marco', text: 'The buyer is very happy. The ship sails tonight, so nobody will ever find it.' },
      { type: 'reward', cash: 1200, par: 240, bonus: 300 },
    ],
  },
  {
    id: 'beach-run',
    title: 'Beach Run',
    giver: 'Marco',
    summary: 'Race a medical kit from the beach to Port Solano General.',
    requires: ['first-run'],
    start: { x: 218, z: 37 },
    where: 'outside Solano Customs, Eastgate',
    steps: [
      { type: 'message', from: 'Marco', text: 'Favour for a friend: the lifeguards at Solano Beach have an urgent medical kit for the hospital. Go and get it.' },
      { type: 'goto', x: 60, z: 371, r: 4, label: 'Collect the medical kit from the lifeguard tower' },
      { type: 'message', from: 'Lifeguard', text: 'Thank goodness! Port Solano General, as fast as you can. They need this in 80 seconds.' },
      { type: 'timer', seconds: 80, checkpoint: true },
      { type: 'drive', x: -200, z: -3, r: 7, stop: true, label: 'Rush the kit to Port Solano General' },
      { type: 'message', from: 'Marco', text: 'The hospital called. You made it with time to spare. Here is the reward they sent.' },
      { type: 'reward', cash: 800 },
    ],
  },
];
