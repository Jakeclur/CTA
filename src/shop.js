// Places to spend money: the Solano Customs car dealer, the garage where owned
// cars are kept, and the PetroSol convenience stores.
import { Marker } from './missions.js';
import { VEHICLE_TYPES } from './vehicles.js';
import { formatMoney } from './utils.js';

export const DEALER_STOCK = [
  { type: 'compact', price: 1500 },
  { type: 'sedan', price: 2500 },
  { type: 'taxi', price: 2800 },
  { type: 'van', price: 3000 },
  { type: 'ute', price: 3500 },
  { type: 'suv', price: 4200 },
  { type: 'muscle', price: 7500 },
  { type: 'sports', price: 9500 },
];

export const STORE_ITEMS = [
  { id: 'snack', name: 'Choc-Mint Bar', text: 'Restores 20 health.', price: 6, heal: 20 },
  { id: 'burger', name: 'Surf Burger', text: 'Restores 45 health.', price: 14, heal: 45 },
  { id: 'firstaid', name: 'First Aid Kit', text: 'Restores you to full health.', price: 45, heal: 100 },
];

export const GARAGE_SLOTS = 6;

export class Shops {
  constructor(game) {
    this.g = game;
    const P = game.world.places;
    this.garage = P.garage;
    this.stores = P.stores;
    this.owned = []; // [{ id, type, color }]
    this.nextId = 1;
    this.markers = [
      { kind: 'dealer', ...P.garage.dealer, marker: new Marker(game.scene, '#34d399', 1.1) },
      { kind: 'garage', ...P.garage.bay, marker: new Marker(game.scene, '#facc15', 2.4) },
      ...P.stores.map((s) => ({ kind: 'store', ...s, marker: new Marker(game.scene, '#34d399', 1.1) })),
    ];
  }

  load(list) {
    this.owned = (list || []).filter((o) => VEHICLE_TYPES[o.type]).map((o) => ({ ...o, id: this.nextId++ }));
  }

  serialize() {
    return this.owned.map(({ type, color }) => ({ type, color }));
  }

  // The shop the player is standing in, if any.
  nearby() {
    const g = this.g;
    const pos = g.playerPosition();
    const inCar = !!g.player.vehicle;
    for (const m of this.markers) {
      const r = m.kind === 'garage' ? 3.2 : 1.6;
      if (Math.hypot(pos.x - m.x, pos.z - m.z) > r) continue;
      if (m.kind !== 'garage' && inCar) continue;
      return m;
    }
    return null;
  }

  prompt(m) {
    if (m.kind === 'dealer') return '<kbd>F</kbd> Browse cars for sale';
    if (m.kind === 'store') return '<kbd>F</kbd> Shop at PetroSol';
    return this.g.player.vehicle ? '<kbd>F</kbd> Store this car in your garage' : '<kbd>F</kbd> Open your garage';
  }

  update(t) {
    const g = this.g;
    const pos = g.playerPosition();
    for (const m of this.markers) {
      const show = Math.hypot(pos.x - m.x, pos.z - m.z) < 120 && !g.missions.active;
      if (!show) {
        m.marker.hide();
        continue;
      }
      m.marker.show(m.x, g.world.heightAt(m.x, m.z), m.z, m.kind === 'garage' ? 0.35 : 0.6);
      m.marker.update(t);
    }
  }

  // ------------------------------------------------------------------ actions

  // Builds the list shown on the shop screen for this place.
  open(m) {
    const g = this.g;
    if (m.kind === 'garage' && g.player.vehicle) return this.store();
    if (m.kind === 'dealer') {
      return {
        title: 'Solano Customs',
        sub: 'New and nearly new cars. Delivered to the forecourt.',
        rows: DEALER_STOCK.map((s) => {
          const spec = VEHICLE_TYPES[s.type];
          return {
            name: spec.name,
            text: `Top speed ${Math.round(spec.maxSpeed * 3.6)} km/h`,
            price: formatMoney(s.price),
            action: 'Buy',
            disabled: g.cash < s.price || this.owned.length >= GARAGE_SLOTS,
            run: () => this.buy(s),
          };
        }),
        note: this.owned.length >= GARAGE_SLOTS ? 'Your garage is full. Sell a car first.' : `Garage: ${this.owned.length} of ${GARAGE_SLOTS} spaces used.`,
      };
    }
    if (m.kind === 'store') {
      return {
        title: 'PetroSol Store',
        sub: 'Snacks and supplies.',
        rows: STORE_ITEMS.map((it) => ({
          name: it.name,
          text: it.text,
          price: formatMoney(it.price),
          action: 'Buy',
          disabled: g.cash < it.price || g.player.health >= 100,
          run: () => this.eat(it),
        })),
        note: g.player.health >= 100 ? 'You are already at full health.' : '',
      };
    }
    return {
      title: 'Your garage',
      sub: 'Drive any car into the yellow bay to keep it here.',
      rows: this.owned.map((o) => ({
        name: VEHICLE_TYPES[o.type].name,
        text: o.out ? 'Parked out in the city' : 'In the garage',
        swatch: o.color,
        action: o.out ? 'Bring back' : 'Take out',
        run: () => this.takeOut(o),
        extra: { label: `Sell ${formatMoney(this.value(o))}`, run: () => this.sell(o) },
      })),
      note: this.owned.length ? `${this.owned.length} of ${GARAGE_SLOTS} spaces used.` : 'Your garage is empty. Buy a car at the dealer or drive one in.',
    };
  }

  value(o) {
    const s = DEALER_STOCK.find((x) => x.type === o.type);
    return Math.round((s ? s.price : 2000) * 0.4);
  }

  // Put a car on the forecourt, moving anything parked in the way.
  deliver(type, color, owned) {
    const g = this.g;
    const d = this.garage.delivery;
    for (const v of [...g.vehicles.list]) {
      if (Math.hypot(v.x - d.x, v.z - d.z) < 5 && v !== g.player.vehicle && v.role !== 'mission') g.vehicles.remove(v);
    }
    const v = g.vehicles.spawn(type, d.x, d.z, d.heading, color);
    v.ownedId = owned.id;
    owned.out = true;
    return v;
  }

  buy(s) {
    const g = this.g;
    if (g.cash < s.price || this.owned.length >= GARAGE_SLOTS) return;
    g.cash -= s.price;
    const spec = VEHICLE_TYPES[s.type];
    const owned = { id: this.nextId++, type: s.type, color: spec.colors[Math.floor(Math.random() * spec.colors.length)] };
    this.owned.push(owned);
    this.deliver(owned.type, owned.color, owned);
    g.audio.play('buy');
    g.ui.notify(`${spec.name} bought`, 'It is waiting for you on the forecourt and is saved in your garage.', 'money');
    g.saveNow();
  }

  takeOut(o) {
    const g = this.g;
    const old = g.vehicles.list.find((v) => v.ownedId === o.id);
    if (old === g.player.vehicle) return;
    if (old) g.vehicles.remove(old);
    this.deliver(o.type, o.color, o);
    g.ui.notify(VEHICLE_TYPES[o.type].name, 'Your car is on the forecourt.', '');
  }

  sell(o) {
    const g = this.g;
    const v = g.vehicles.list.find((x) => x.ownedId === o.id);
    if (v === g.player.vehicle) return;
    if (v) g.vehicles.remove(v);
    this.owned.splice(this.owned.indexOf(o), 1);
    g.cash += this.value(o);
    g.audio.play('cash');
    g.ui.notify('Car sold', `+${formatMoney(this.value(o))}`, 'money');
    g.saveNow();
  }

  eat(it) {
    const g = this.g;
    if (g.cash < it.price || g.player.health >= 100) return;
    g.cash -= it.price;
    g.player.health = Math.min(100, g.player.health + it.heal);
    g.audio.play('buy');
    g.ui.notify(it.name, `Health ${Math.round(g.player.health)}.`, 'money');
  }

  // Driving a car into the bay keeps it.
  store() {
    const g = this.g;
    const v = g.player.vehicle;
    if (v.role === 'mission') {
      g.ui.notify('Not now', 'This car is needed for the mission.', 'warn');
      return null;
    }
    if (g.police.level > 0) {
      g.ui.notify('Not now', 'Lose the police before using the garage.', 'warn');
      return null;
    }
    let o = this.owned.find((x) => x.id === v.ownedId);
    if (!o) {
      if (this.owned.length >= GARAGE_SLOTS) {
        g.ui.notify('Garage full', `You can keep ${GARAGE_SLOTS} cars. Sell one first.`, 'warn');
        return null;
      }
      o = { id: this.nextId++, type: v.type, color: v.color };
      this.owned.push(o);
    }
    o.out = false;
    // the player steps out beside the bay and the car goes inside
    g.leaveVehicleInstant();
    g.vehicles.remove(v);
    const d = this.garage.delivery;
    g.player.setPosition(d.x - 6, g.world.heightAt(d.x - 6, d.z - 4), d.z - 4, 0);
    g.player.setVisible(true);
    g.audio.play('door');
    g.ui.notify(`${VEHICLE_TYPES[o.type].name} stored`, 'Take it out again from the garage bay at any time.', 'money');
    g.saveNow();
    return null;
  }
}
