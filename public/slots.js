// ═══════════════════════════════════════════
// SLOT MACHINE — 3-Reel with Driver/Team names
// ═══════════════════════════════════════════

import { DRIVERS, TEAMS } from './constants.js';

export class SlotMachine {
  constructor(reel1El, reel2El, reel3El, onComplete) {
    this.reels = [reel1El, reel2El, reel3El];
    this.onComplete = onComplete; // callback(result) — result from API
    this.spinning = false;

    // Build reel item lists
    this.driverNames = DRIVERS.map(d => d.name);
    this.teamNames = TEAMS.map(t => t.name);

    // Populate initial reels
    this._populateReel(0, this.driverNames);
    this._populateReel(1, this.driverNames);
    this._populateReel(2, this.teamNames);
  }

  _populateReel(reelIdx, items) {
    const el = this.reels[reelIdx];
    el.innerHTML = '';

    // Create enough items to scroll through (repeat list 4x for smooth animation)
    const repeats = 4;
    for (let r = 0; r < repeats; r++) {
      for (const name of items) {
        const div = document.createElement('div');
        div.className = 'reel-item';
        div.textContent = name;
        el.appendChild(div);
      }
    }

    // Show middle item
    const itemHeight = 60;
    const centerOffset = (el.parentElement.clientHeight / 2) - (itemHeight / 2);
    const startIdx = Math.floor(items.length * 1.5);
    el.style.transform = `translateY(${centerOffset - startIdx * itemHeight}px)`;
  }

  async spin(apiResult) {
    if (this.spinning) return;
    this.spinning = true;

    // Target names from API result
    const targets = [
      apiResult.drivers[0].name.split(' ').pop(), // last name
      apiResult.drivers[1].name.split(' ').pop(),
      apiResult.teams[0].name,
    ];

    // Animate each reel
    const durations = [1800, 2400, 3000]; // staggered stop times

    const promises = this.reels.map((reel, i) => {
      const items = i < 2 ? this.driverNames : this.teamNames;
      const targetName = targets[i];
      return this._animateReel(reel, items, targetName, durations[i]);
    });

    await Promise.all(promises);
    this.spinning = false;

    // Brief pause then show results
    await new Promise(r => setTimeout(r, 600));
    this.onComplete(apiResult);
  }

  _animateReel(reelEl, items, targetName, duration) {
    return new Promise(resolve => {
      const itemHeight = 60;
      const containerHeight = reelEl.parentElement.clientHeight;
      const centerOffset = (containerHeight / 2) - (itemHeight / 2);

      // Find target index in the items array
      let targetIdx = items.findIndex(n => n === targetName);
      if (targetIdx === -1) targetIdx = 0;

      // Rebuild reel content: many spins + land on target
      reelEl.innerHTML = '';

      // Add 5 full cycles of random items for the spin effect
      const spinCycles = 5;
      const allItems = [];
      for (let c = 0; c < spinCycles; c++) {
        const shuffled = [...items].sort(() => Math.random() - 0.5);
        allItems.push(...shuffled);
      }

      // Add final sequence: items leading to target in the center
      // We want: [prev item] [TARGET] [next item] visible
      const prevIdx = (targetIdx - 1 + items.length) % items.length;
      const nextIdx = (targetIdx + 1) % items.length;
      allItems.push(items[prevIdx], items[targetIdx], items[nextIdx]);

      for (const name of allItems) {
        const div = document.createElement('div');
        div.className = 'reel-item';
        div.textContent = name;
        reelEl.appendChild(div);
      }

      // The target item is at index (allItems.length - 2) (second to last)
      const finalItemIdx = allItems.length - 2;
      const finalY = centerOffset - finalItemIdx * itemHeight;

      // Start from top
      const startY = centerOffset;
      reelEl.style.transition = 'none';
      reelEl.style.transform = `translateY(${startY}px)`;

      // Force reflow
      reelEl.offsetHeight;

      // Animate with CSS easing
      reelEl.style.transition = `transform ${duration}ms cubic-bezier(0.15, 0.85, 0.35, 1.0)`;
      reelEl.style.transform = `translateY(${finalY}px)`;

      // Highlight the center item after animation
      setTimeout(() => {
        const children = reelEl.children;
        for (let c = 0; c < children.length; c++) {
          children[c].classList.remove('highlight');
        }
        if (children[finalItemIdx]) {
          children[finalItemIdx].classList.add('highlight');
        }
        resolve();
      }, duration + 50);
    });
  }

  reset() {
    this._populateReel(0, this.driverNames);
    this._populateReel(1, this.driverNames);
    this._populateReel(2, this.teamNames);
  }
}
