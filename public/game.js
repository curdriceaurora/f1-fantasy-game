// ═══════════════════════════════════════════
// TANK AIMING GAME — PocketTanks-style
// ═══════════════════════════════════════════

export class TankGame {
  constructor(canvas, onFired) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.onFired = onFired; // callback(accuracy)
    this.state = 'aiming'; // aiming | firing | landed

    // Physics constants (tuned so 45°/50% ≈ hits target)
    this.GRAVITY = 500;
    this.MAX_VELOCITY = 1100;

    // Wind
    this.windSpeed = (Math.random() - 0.5) * 40; // -20 to +20 px/s²

    // Terrain seed (random per session)
    this.terrainPhases = [
      Math.random() * Math.PI * 2,
      Math.random() * Math.PI * 2,
      Math.random() * Math.PI * 2,
    ];

    // Projectile state
    this.proj = { x: 0, y: 0, vx: 0, vy: 0 };
    this.trail = [];
    this.particles = [];
    this.landingX = null;

    // Timing
    this.lastTime = 0;
    this.animId = null;

    this._resize();
    window.addEventListener('resize', () => this._resize());
  }

  _resize() {
    const rect = this.canvas.getBoundingClientRect();
    const dpr = window.devicePixelRatio || 1;
    this.W = rect.width;
    this.H = rect.height;
    this.canvas.width = this.W * dpr;
    this.canvas.height = this.H * dpr;
    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

    // Positions
    this.tankX = this.W * 0.12;
    this.targetX = this.W * 0.82;
    this.maxDist = this.W * 0.85;
  }

  terrainY(x) {
    const base = this.H * 0.62;
    const p = this.terrainPhases;
    return base
      + 35 * Math.sin(x * 0.004 + p[0])
      + 18 * Math.sin(x * 0.009 + p[1])
      + 8  * Math.sin(x * 0.022 + p[2]);
  }

  getWindLabel() {
    if (Math.abs(this.windSpeed) < 2) return 'Wind: calm';
    const dir = this.windSpeed > 0 ? '→' : '←';
    return `Wind: ${dir} ${Math.abs(this.windSpeed).toFixed(0)}`;
  }

  fire(angleDeg, powerPct) {
    if (this.state !== 'aiming') return;
    this.state = 'firing';

    const angle = angleDeg * Math.PI / 180;
    const v0 = (powerPct / 100) * this.MAX_VELOCITY;
    const tankY = this.terrainY(this.tankX) - 12;

    this.proj = {
      x: this.tankX + 20,
      y: tankY - 10,
      vx: v0 * Math.cos(angle),
      vy: -v0 * Math.sin(angle),
    };
    this.trail = [];
    this.particles = [];
    this.landingX = null;

    this.lastTime = performance.now();
    this._animate(this.lastTime);
  }

  _animate(now) {
    const dt = Math.min((now - this.lastTime) / 1000, 0.05);
    this.lastTime = now;

    if (this.state === 'firing') {
      // Update physics
      this.proj.vx += this.windSpeed * dt;
      this.proj.vy += this.GRAVITY * dt;
      this.proj.x += this.proj.vx * dt;
      this.proj.y += this.proj.vy * dt;

      // Trail
      this.trail.push({ x: this.proj.x, y: this.proj.y });
      if (this.trail.length > 30) this.trail.shift();

      // Collision with terrain
      const groundY = this.terrainY(this.proj.x);
      if (this.proj.y >= groundY) {
        this.proj.y = groundY;
        this.state = 'landed';
        this.landingX = this.proj.x;
        this._spawnParticles(this.proj.x, groundY);

        // Calculate accuracy
        const dist = Math.abs(this.landingX - this.targetX);
        const accuracy = Math.max(0, 1 - dist / this.maxDist);
        setTimeout(() => this.onFired(accuracy), 1200);
      }

      // Off-screen
      if (this.proj.x < -50 || this.proj.x > this.W + 50 || this.proj.y > this.H + 50) {
        this.state = 'landed';
        this.landingX = this.proj.x;
        setTimeout(() => this.onFired(0), 800);
      }
    }

    // Update particles
    for (const p of this.particles) {
      p.vx *= 0.97;
      p.vy += 300 * dt;
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.life -= dt;
    }
    this.particles = this.particles.filter(p => p.life > 0);

    this._draw();

    if (this.state === 'firing' || this.particles.length > 0) {
      this.animId = requestAnimationFrame(t => this._animate(t));
    }
  }

  _spawnParticles(x, y) {
    for (let i = 0; i < 25; i++) {
      const angle = Math.random() * Math.PI * 2;
      const speed = 80 + Math.random() * 200;
      this.particles.push({
        x, y,
        vx: Math.cos(angle) * speed,
        vy: Math.sin(angle) * speed - 150,
        life: 0.5 + Math.random() * 0.8,
        color: ['#ff4400', '#ff8800', '#ffcc00', '#fff'][Math.floor(Math.random() * 4)],
        size: 2 + Math.random() * 4,
      });
    }
  }

  draw(angleDeg) {
    this._currentAngle = angleDeg;
    this._draw();
  }

  _draw() {
    const ctx = this.ctx;
    const W = this.W;
    const H = this.H;

    // ── Sky gradient ──
    const skyGrad = ctx.createLinearGradient(0, 0, 0, H * 0.6);
    skyGrad.addColorStop(0, '#0a0a2a');
    skyGrad.addColorStop(0.5, '#0d1b3e');
    skyGrad.addColorStop(1, '#1a2d5a');
    ctx.fillStyle = skyGrad;
    ctx.fillRect(0, 0, W, H);

    // ── Stars ──
    ctx.fillStyle = 'rgba(255,255,255,0.4)';
    const seed = this.terrainPhases[0] * 1000;
    for (let i = 0; i < 40; i++) {
      const sx = ((seed + i * 137.5) % W);
      const sy = ((seed + i * 97.3) % (H * 0.45));
      ctx.fillRect(sx, sy, 1.5, 1.5);
    }

    // ── Terrain ──
    ctx.beginPath();
    ctx.moveTo(0, H);
    for (let x = 0; x <= W; x += 2) {
      ctx.lineTo(x, this.terrainY(x));
    }
    ctx.lineTo(W, H);
    ctx.closePath();

    const terrGrad = ctx.createLinearGradient(0, H * 0.5, 0, H);
    terrGrad.addColorStop(0, '#1a5c1a');
    terrGrad.addColorStop(0.3, '#145214');
    terrGrad.addColorStop(1, '#0a2a0a');
    ctx.fillStyle = terrGrad;
    ctx.fill();

    // Terrain surface line
    ctx.beginPath();
    for (let x = 0; x <= W; x += 2) {
      if (x === 0) ctx.moveTo(x, this.terrainY(x));
      else ctx.lineTo(x, this.terrainY(x));
    }
    ctx.strokeStyle = '#2a8a2a';
    ctx.lineWidth = 2;
    ctx.stroke();

    // ── Target (checkered bullseye) ──
    const tgtY = this.terrainY(this.targetX);
    this._drawTarget(this.targetX, tgtY);

    // ── F1 Car / Tank ──
    const tankY = this.terrainY(this.tankX);
    this._drawTank(this.tankX, tankY, this._currentAngle || 45);

    // ── Trail ──
    if (this.trail.length > 1) {
      for (let i = 1; i < this.trail.length; i++) {
        const alpha = i / this.trail.length;
        ctx.beginPath();
        ctx.arc(this.trail[i].x, this.trail[i].y, 2, 0, Math.PI * 2);
        ctx.fillStyle = `rgba(255,255,255,${alpha * 0.7})`;
        ctx.fill();
      }
    }

    // ── Projectile ──
    if (this.state === 'firing') {
      ctx.beginPath();
      ctx.arc(this.proj.x, this.proj.y, 5, 0, Math.PI * 2);
      ctx.fillStyle = '#ff3300';
      ctx.fill();
      ctx.strokeStyle = '#ffcc00';
      ctx.lineWidth = 2;
      ctx.stroke();
    }

    // ── Particles ──
    for (const p of this.particles) {
      ctx.globalAlpha = Math.max(0, p.life);
      ctx.beginPath();
      ctx.arc(p.x, p.y, p.size, 0, Math.PI * 2);
      ctx.fillStyle = p.color;
      ctx.fill();
    }
    ctx.globalAlpha = 1;

    // ── Landing marker + distance line ──
    if (this.state === 'landed' && this.landingX != null) {
      const lx = this.landingX;
      const ly = this.terrainY(Math.max(0, Math.min(W, lx)));

      // Flag at landing
      ctx.fillStyle = '#fff';
      ctx.fillRect(lx, ly - 20, 2, 20);
      ctx.fillStyle = '#ff3300';
      ctx.fillRect(lx + 2, ly - 20, 10, 7);

      // Dotted line to target
      ctx.setLineDash([4, 4]);
      ctx.beginPath();
      ctx.moveTo(lx, ly - 24);
      ctx.lineTo(this.targetX, tgtY - 24);
      ctx.strokeStyle = 'rgba(255,255,255,0.4)';
      ctx.lineWidth = 1;
      ctx.stroke();
      ctx.setLineDash([]);

      // Distance text
      const dist = Math.abs(lx - this.targetX).toFixed(0);
      const midX = (lx + this.targetX) / 2;
      ctx.font = '12px Orbitron, monospace';
      ctx.fillStyle = 'rgba(255,255,255,0.7)';
      ctx.textAlign = 'center';
      ctx.fillText(`${dist}px`, midX, Math.min(ly, tgtY) - 30);
    }
  }

  _drawTarget(x, y) {
    const ctx = this.ctx;
    const rings = [20, 14, 8, 3];
    const colors = ['#fff', '#e10600', '#fff', '#e10600'];
    for (let i = 0; i < rings.length; i++) {
      ctx.beginPath();
      ctx.arc(x, y - rings[i], rings[i], 0, Math.PI * 2);
      ctx.fillStyle = colors[i];
      ctx.fill();
    }
    // Flag pole
    ctx.fillStyle = '#888';
    ctx.fillRect(x - 1, y - 44, 2, 28);
    // Checkered flag
    const flagSize = 4;
    for (let r = 0; r < 3; r++) {
      for (let c = 0; c < 4; c++) {
        ctx.fillStyle = (r + c) % 2 === 0 ? '#fff' : '#222';
        ctx.fillRect(x + 1 + c * flagSize, y - 44 + r * flagSize, flagSize, flagSize);
      }
    }
  }

  _drawTank(x, y, angleDeg) {
    const ctx = this.ctx;

    // Car body (simplified F1 car silhouette)
    ctx.fillStyle = '#e10600';
    ctx.beginPath();
    ctx.moveTo(x - 18, y - 4);
    ctx.lineTo(x - 10, y - 10);
    ctx.lineTo(x + 12, y - 12);
    ctx.lineTo(x + 22, y - 8);
    ctx.lineTo(x + 22, y - 4);
    ctx.lineTo(x - 18, y - 4);
    ctx.closePath();
    ctx.fill();

    // Cockpit
    ctx.fillStyle = '#111';
    ctx.fillRect(x - 2, y - 14, 8, 5);

    // Wheels
    ctx.fillStyle = '#222';
    ctx.beginPath();
    ctx.arc(x - 12, y - 2, 5, 0, Math.PI * 2);
    ctx.fill();
    ctx.beginPath();
    ctx.arc(x + 16, y - 2, 5, 0, Math.PI * 2);
    ctx.fill();

    // Launch ramp (barrel)
    const barrelLen = 28;
    const rad = angleDeg * Math.PI / 180;
    const bx = x + 5;
    const by = y - 12;
    ctx.save();
    ctx.translate(bx, by);
    ctx.rotate(-rad);
    ctx.fillStyle = '#888';
    ctx.fillRect(0, -2, barrelLen, 4);
    ctx.fillStyle = '#aaa';
    ctx.fillRect(barrelLen - 4, -3, 4, 6);
    ctx.restore();
  }

  reset() {
    this.state = 'aiming';
    this.trail = [];
    this.particles = [];
    this.landingX = null;
    this.windSpeed = (Math.random() - 0.5) * 40;
    this.terrainPhases = [
      Math.random() * Math.PI * 2,
      Math.random() * Math.PI * 2,
      Math.random() * Math.PI * 2,
    ];
    if (this.animId) cancelAnimationFrame(this.animId);
    this._resize();
    this._draw();
  }
}
