import { HALF_WALL_THICKNESS, hash2i, hash32, rand01FromI } from "./ChunkedMap.js";
export class Raycaster {
    constructor(scene, w, h, textures, mapAccessor, roomAccessor = null, holeAccessor = null) {
        this.scene = scene;
        this.w = w;
        this.h = h;
        this.mapAccessor = mapAccessor;
        this.roomAccessor = roomAccessor;
        this.holeAccessor = holeAccessor;

        this.canvas = document.createElement('canvas');
        this.canvas.width = w;
        this.canvas.height = h;
        this.ctx = this.canvas.getContext('2d', { alpha: false });
        this.imageData = this.ctx.createImageData(w, h);
        this.buf = this.imageData.data;
        // Animation frames are filled from MainScene after textures load.
        this.entityAnimations = {};
        this.grimeCache = new Map();
        this.vhsScratch = new Uint8ClampedArray(this.buf.length);

        this.texWall = textures.wall;
        this.texFloor = textures.floor;
        this.texCeil = textures.ceil;

        this.wallW = this.texWall.width; this.wallH = this.texWall.height;
        this.floorW = this.texFloor.width; this.floorH = this.texFloor.height;
        this.ceilW = this.texCeil.width; this.ceilH = this.texCeil.height;

        this.wallPx = this._makeSeamless(this._readPixels(this.texWall), this.wallW, this.wallH);
        this.floorPx = this._makeSeamless(this._readPixels(this.texFloor), this.floorW, this.floorH);
        this.ceilPx = this._makeSeamless(this._readPixels(this.texCeil), this.ceilW, this.ceilH);

        this.out = scene.textures.createCanvas('view', w, h);
        this.sprite = scene.add.image(0, 0, 'view').setOrigin(0, 0);
        this.sprite.setScrollFactor(0);

        this.fogColor = { r: 22, g: 23, b: 18 };
    }

    _readPixels(img) {
        const c = document.createElement('canvas');
        c.width = img.width; c.height = img.height;
        const cx = c.getContext('2d');
        cx.drawImage(img, 0, 0);
        return cx.getImageData(0, 0, img.width, img.height).data;
    }

    _makeSeamless(px, width, height) {
        const horizontal = new Uint8ClampedArray(px);
        const blendX = Math.max(2, Math.round(width * 0.08));
        for (let y = 0; y < height; y++) {
            for (let edge = 0; edge < blendX; edge++) {
                const leftX = edge;
                const rightX = width - 1 - edge;
                const fade = 1 - edge / (blendX - 1);
                for (let channel = 0; channel < 4; channel++) {
                    const leftIndex = (y * width + leftX) * 4 + channel;
                    const rightIndex = (y * width + rightX) * 4 + channel;
                    const average = (px[leftIndex] + px[rightIndex]) * 0.5;
                    horizontal[leftIndex] = px[leftIndex] * (1 - fade) + average * fade;
                    horizontal[rightIndex] = px[rightIndex] * (1 - fade) + average * fade;
                }
            }
        }

        const seamless = new Uint8ClampedArray(horizontal);
        const blendY = Math.max(2, Math.round(height * 0.08));
        for (let x = 0; x < width; x++) {
            for (let edge = 0; edge < blendY; edge++) {
                const topY = edge;
                const bottomY = height - 1 - edge;
                const fade = 1 - edge / (blendY - 1);
                for (let channel = 0; channel < 4; channel++) {
                    const topIndex = (topY * width + x) * 4 + channel;
                    const bottomIndex = (bottomY * width + x) * 4 + channel;
                    const average = (horizontal[topIndex] + horizontal[bottomIndex]) * 0.5;
                    seamless[topIndex] = horizontal[topIndex] * (1 - fade) + average * fade;
                    seamless[bottomIndex] = horizontal[bottomIndex] * (1 - fade) + average * fade;
                }
            }
        }
        return seamless;
    }

    _sample(px, tw, th, u, v) {
        u = ((u % tw) + tw) % tw;
        v = ((v % th) + th) % th;
        const i = (v * tw + u) * 4;
        return [px[i], px[i + 1], px[i + 2]];
    }

    _mixFog(r, g, b, dist) {
        const k = Math.min(1, dist / 16);
        const fr = this.fogColor.r, fg = this.fogColor.g, fb = this.fogColor.b;
        return [
            (r * (1 - k) + fr * k) | 0,
            (g * (1 - k) + fg * k) | 0,
            (b * (1 - k) + fb * k) | 0
        ];
    }

    resizeToScreen() {
        const sw = this.scene.scale.width;
        const sh = this.scene.scale.height;
        const sx = sw / this.w;
        const sy = sh / this.h;
        const s = Math.floor(Math.min(sx, sy));
        this.sprite.setScale(Math.max(1, s));
    }

    _grimeFactor(wx, wy, kindSeed) {
        const ix = wx | 0;
        const iy = wy | 0;
        const cacheKey = `${kindSeed}:${ix}:${iy}`;
        const cached = this.grimeCache.get(cacheKey);
        if (cached !== undefined) return cached;

        const h = hash2i(ix, iy, kindSeed);
        const a = rand01FromI(h);
        const b = rand01FromI(hash32(h ^ 0x9e3779b9));
        const stain = (a < 0.06) ? (0.55 + b * 0.25) : (0.88 + b * 0.22);
        if (this.grimeCache.size > 8192) this.grimeCache.clear();
        this.grimeCache.set(cacheKey, stain);
        return stain;
    }

    _smoothRandom(wx, wy, kindSeed) {
        const x0 = Math.floor(wx);
        const y0 = Math.floor(wy);
        const fx = wx - x0;
        const fy = wy - y0;
        const sx = fx * fx * (3 - 2 * fx);
        const sy = fy * fy * (3 - 2 * fy);
        const top = Phaser.Math.Linear(
            rand01FromI(hash2i(x0, y0, kindSeed)),
            rand01FromI(hash2i(x0 + 1, y0, kindSeed)),
            sx
        );
        const bottom = Phaser.Math.Linear(
            rand01FromI(hash2i(x0, y0 + 1, kindSeed)),
            rand01FromI(hash2i(x0 + 1, y0 + 1, kindSeed)),
            sx
        );
        return Phaser.Math.Linear(top, bottom, sy);
    }

    _smoothGrime(wx, wy, kindSeed) {
        const x0 = Math.floor(wx);
        const y0 = Math.floor(wy);
        const fx = wx - x0;
        const fy = wy - y0;
        const sx = fx * fx * (3 - 2 * fx);
        const sy = fy * fy * (3 - 2 * fy);
        const top = Phaser.Math.Linear(
            this._grimeFactor(x0, y0, kindSeed),
            this._grimeFactor(x0 + 1, y0, kindSeed),
            sx
        );
        const bottom = Phaser.Math.Linear(
            this._grimeFactor(x0, y0 + 1, kindSeed),
            this._grimeFactor(x0 + 1, y0 + 1, kindSeed),
            sx
        );
        return Phaser.Math.Linear(top, bottom, sy);
    }

    _applyTint(r, g, b, tint) {
        return [(r * tint.r) | 0, (g * tint.g) | 0, (b * tint.b) | 0];
    }

    _localLight(wx, wy, power) {
        const inLargeRoom = this.roomAccessor?.(wx, wy, 1) || false;
        const spacingX = 2;
        const spacingY = inLargeRoom ? 2 : 3;
        const wrappedX = ((wx - 1.5) % spacingX + spacingX) % spacingX;
        const wrappedY = ((wy - 1.5) % spacingY + spacingY) % spacingY;
        const dx = Math.min(wrappedX, spacingX - wrappedX);
        const dy = Math.min(wrappedY, spacingY - wrappedY);
        const distance = Math.hypot(dx, dy);
        const falloffRadius = inLargeRoom ? 1.45 : 1.35;
        const falloff = Math.max(0, 1 - distance / falloffRadius);

        // Keep shadowed corridors readable while preserving distinct pools
        // beneath the fluorescent fixtures.
        return 0.12 + Math.pow(falloff, 2.15) * 1.42 * power;
    }

    _ceilingFixture(wx, wy, u, v) {
        // Match _localLight's room margin exactly so every generated light
        // pool has a visible ceiling fixture on the same grid.
        const inLargeRoom = this.roomAccessor?.(wx, wy, 1) || false;
        const spacingX = 2;
        const spacingY = inLargeRoom ? 2 : 3;
        const gridX = ((wx % spacingX) + spacingX) % spacingX;
        const gridY = ((wy % spacingY) + spacingY) % spacingY;
        if (gridX !== 1 || gridY !== 1) return 0;

        // A narrow fluorescent panel, metal surround, and broad glow area.
        const inGlow = u >= 0.01 && u <= 0.99 && v >= 0.16 && v <= 0.84;
        if (!inGlow) return 0;

        const inFrame = u >= 0.08 && u <= 0.92 && v >= 0.27 && v <= 0.73;
        if (!inFrame) return 3;

        const inLamp = u >= 0.13 && u <= 0.87 && v >= 0.32 && v <= 0.68;
        return inLamp ? 2 : 1;
    }

    _applyVhsOverlay(timeMs = 0) {
        const w = this.w;
        const h = this.h;
        const source = this.vhsScratch;
        source.set(this.buf);

        const frame = Math.floor(timeMs / 33);
        const trackingY = ((timeMs * 0.045) % (h + 80)) - 40;

        for (let y = 0; y < h; y++) {
            const rowHash = hash32(frame ^ Math.imul(y + 1, 0x45d9f3b));
            const heavyJitter = (rowHash & 255) < 5;
            const jitter = heavyJitter
                ? ((rowHash >>> 8) % 7) - 3
                : ((rowHash >>> 8) % 3) - 1;
            const trackingDistance = Math.abs(y - trackingY);
            const trackingGain = trackingDistance < 2
                ? 1.24
                : trackingDistance < 7 ? 1.08 : 1;
            const scanline = y % 3 === 0 ? 0.92 : 1;

            for (let x = 0; x < w; x++) {
                const greenX = Phaser.Math.Clamp(x + jitter, 0, w - 1);
                const redX = Phaser.Math.Clamp(greenX + 1, 0, w - 1);
                const blueX = Phaser.Math.Clamp(greenX - 1, 0, w - 1);
                const redIndex = (y * w + redX) * 4;
                const greenIndex = (y * w + greenX) * 4;
                const blueIndex = (y * w + blueX) * 4;
                const index = (y * w + x) * 4;

                const noiseHash = hash32(
                    frame ^
                    Math.imul(x + 1, 73856093) ^
                    Math.imul(y + 1, 19349663)
                );
                const noise = ((noiseHash >>> 24) / 255 - 0.5) * 15;
                const nx = (x / (w - 1)) * 2 - 1;
                const ny = (y / (h - 1)) * 2 - 1;
                const vignette = Math.max(0.78, 1 - (nx * nx + ny * ny) * 0.1);
                const gain = 1.1 * scanline * trackingGain * vignette;

                this.buf[index] = source[redIndex] * gain + noise + 2;
                this.buf[index + 1] = source[greenIndex + 1] * gain + noise;
                this.buf[index + 2] = source[blueIndex + 2] * gain + noise + 4;
                this.buf[index + 3] = 255;
            }
        }
    }

    _applyFallOverlay(amount = 0) {
        if (amount <= 0) return;
        const darkness = Math.max(0, 1 - amount * 1.12);
        const centerX = this.w * 0.5;
        const centerY = this.h * 0.72;
        const maxDistance = Math.hypot(centerX, centerY);
        for (let y = 0; y < this.h; y++) {
            for (let x = 0; x < this.w; x++) {
                const index = (y * this.w + x) * 4;
                const radial = Math.hypot(x - centerX, y - centerY) / maxDistance;
                const edgeFade = Math.max(0, 1 - amount * radial * 1.8);
                const gain = darkness * edgeFade;
                this.buf[index] *= gain;
                this.buf[index + 1] *= gain;
                this.buf[index + 2] *= gain;
            }
        }
    }

    _applyExitOverlay(amount = 0) {
        if (amount <= 0) return;
        const glowR = 205;
        const glowG = 255;
        const glowB = 211;
        for (let index = 0; index < this.buf.length; index += 4) {
            this.buf[index] = this.buf[index] * (1 - amount) + glowR * amount;
            this.buf[index + 1] = this.buf[index + 1] * (1 - amount) + glowG * amount;
            this.buf[index + 2] = this.buf[index + 2] * (1 - amount) + glowB * amount;
        }
    }

    render(state) {
        const {
            posX, posY, dirX, dirY, planeX, planeY,
            pitch, light, time = 0, fallAmount = 0, exitAmount = 0
        } = state;
        const w = this.w, h = this.h;
        const halfH = (h / 2) | 0;
        const horizon = (halfH + pitch) | 0;
        this.zBuffer = this.zBuffer && this.zBuffer.length === this.w ? this.zBuffer : new Float32Array(this.w);
        for (let i = 0; i < this.w; i++) this.zBuffer[i] = Infinity;

        // Clear
        const br = this.fogColor.r, bg = this.fogColor.g, bb = this.fogColor.b;
        for (let i = 0; i < this.buf.length; i += 4) {
            this.buf[i] = br; this.buf[i + 1] = bg; this.buf[i + 2] = bb; this.buf[i + 3] = 255;
        }

        /* -------------------------
           FLOOR + CEILING FIRST
        -------------------------- */
        for (let y = 0; y < h; y++) {
            const isFloor = y > horizon;
            const p = isFloor ? (y - horizon) : (horizon - y);
            if (p <= 0) continue;

            const rowDist = (0.5 * h) / p;

            const rayDirX0 = dirX - planeX;
            const rayDirY0 = dirY - planeY;
            const rayDirX1 = dirX + planeX;
            const rayDirY1 = dirY + planeY;

            const stepX = rowDist * (rayDirX1 - rayDirX0) / w;
            const stepY = rowDist * (rayDirY1 - rayDirY0) / w;

            let floorX = posX + rowDist * rayDirX0;
            let floorY = posY + rowDist * rayDirY0;

            for (let x = 0; x < w; x++) {
                const cellX = floorX | 0;
                const cellY = floorY | 0;

                const tw = isFloor ? this.floorW : this.ceilW;
                const th = isFloor ? this.floorH : this.ceilH;

                const tx = ((floorX - cellX) * tw) | 0;
                const ty = ((floorY - cellY) * th) | 0;

                let r, g, b;
                if (isFloor) [r, g, b] = this._sample(this.floorPx, this.floorW, this.floorH, tx, ty);
                else[r, g, b] = this._sample(this.ceilPx, this.ceilW, this.ceilH, tx, ty);

                const grime = this._smoothGrime(floorX, floorY, isFloor ? 0xF10000 : 0x0CE110);
                const fixture = isFloor ? 0 : this._ceilingFixture(
                    cellX,
                    cellY,
                    tx / this.ceilW,
                    ty / this.ceilH
                );
                const localLight = this._localLight(floorX, floorY, light);

                if (fixture === 2) {
                    // Emissive panels stay bright at a distance but still use
                    // the scene light value so the existing flicker affects them.
                    const emission = Phaser.Math.Clamp(0.25 + light * 1.15, 0.25, 1.4);
                    r = (248 * emission) | 0;
                    g = (246 * emission) | 0;
                    b = (211 * emission) | 0;
                } else {
                    if (fixture === 1) {
                        r = 82; g = 79; b = 59;
                    }
                    const shade = (1.0 / (1.0 + rowDist * 0.085)) * localLight * grime;
                    r = (r * shade) | 0; g = (g * shade) | 0; b = (b * shade) | 0;

                    if (fixture === 3) {
                        const glow = Math.max(0, light) * 72;
                        r = Math.min(255, r + glow) | 0;
                        g = Math.min(255, g + glow * 0.98) | 0;
                        b = Math.min(255, b + glow * 0.72) | 0;
                    }
                }

                if (isFloor && rowDist < 18 && this.holeAccessor?.(floorX, floorY)) {
                    // A nearly black opening with a faint cool tone reads as
                    // depth rather than a painted square on the carpet.
                    const depthNoise = this._smoothRandom(floorX * 3, floorY * 3, 0x484F4C45);
                    r = 1 + depthNoise * 3;
                    g = 2 + depthNoise * 4;
                    b = 4 + depthNoise * 6;
                }

                ;[r, g, b] = this._mixFog(r, g, b, rowDist);

                const idx = (y * w + x) * 4;
                this.buf[idx] = r; this.buf[idx + 1] = g; this.buf[idx + 2] = b; this.buf[idx + 3] = 255;

                floorX += stepX;
                floorY += stepY;
            }
        }

        /* -------------------------
           WALLS LAST (so visible)
        -------------------------- */
        // Sub-tile DDA lets map cells contain thin vertical or horizontal
        // walls while preserving the classic fast grid raycast.
        const rayCellSize = HALF_WALL_THICKNESS;
        for (let x = 0; x < w; x++) {
            const cameraX = 2 * x / w - 1;
            const rayDirX = dirX + planeX * cameraX;
            const rayDirY = dirY + planeY * cameraX;
            const gridRayDirX = rayDirX / rayCellSize;
            const gridRayDirY = rayDirY / rayCellSize;

            const gridPosX = posX / rayCellSize;
            const gridPosY = posY / rayCellSize;
            let mapX = Math.floor(gridPosX);
            let mapY = Math.floor(gridPosY);

            const deltaDistX = gridRayDirX === 0 ? 1e30 : Math.abs(1 / gridRayDirX);
            const deltaDistY = gridRayDirY === 0 ? 1e30 : Math.abs(1 / gridRayDirY);

            let stepX, stepY, sideDistX, sideDistY;
            if (gridRayDirX < 0) { stepX = -1; sideDistX = (gridPosX - mapX) * deltaDistX; }
            else { stepX = 1; sideDistX = (mapX + 1 - gridPosX) * deltaDistX; }
            if (gridRayDirY < 0) { stepY = -1; sideDistY = (gridPosY - mapY) * deltaDistY; }
            else { stepY = 1; sideDistY = (mapY + 1 - gridPosY) * deltaDistY; }

            let hit = 0, side = 0;
            let guard = 0;
            while (!hit && guard++ < 512) {
                if (sideDistX < sideDistY) { sideDistX += deltaDistX; mapX += stepX; side = 0; }
                else { sideDistY += deltaDistY; mapY += stepY; side = 1; }
                const sampleX = (mapX + 0.5) * rayCellSize;
                const sampleY = (mapY + 0.5) * rayCellSize;
                if (this.mapAccessor(sampleX, sampleY)) hit = 1;
            }
            if (!hit) continue;
            let perpWallDist;
            if (side === 0) {
                perpWallDist = (mapX - gridPosX + (1 - stepX) / 2) / gridRayDirX;
            } else {
                perpWallDist = (mapY - gridPosY + (1 - stepY) / 2) / gridRayDirY;
            }
            this.zBuffer[x] = perpWallDist;


            const lineHeight = Math.max(1, (h / perpWallDist) | 0);
            let drawStart = (-lineHeight / 2 + horizon) | 0;
            let drawEnd = (lineHeight / 2 + horizon) | 0;
            drawStart = Math.max(0, drawStart);
            drawEnd = Math.min(h - 1, drawEnd);

            let wallX;
            if (side === 0) wallX = posY + perpWallDist * rayDirY;
            else wallX = posX + perpWallDist * rayDirX;
            wallX -= Math.floor(wallX);

            let texX = (wallX * this.wallW) | 0;
            if (side === 0 && rayDirX > 0) texX = this.wallW - texX - 1;
            if (side === 1 && rayDirY < 0) texX = this.wallW - texX - 1;

            const hitWorldX = posX + perpWallDist * rayDirX;
            const hitWorldY = posY + perpWallDist * rayDirY;
            const surfaceX = hitWorldX + side * 7919;
            const surfaceY = hitWorldY + side * 104729;
            const grime = this._smoothGrime(surfaceX, surfaceY, 0xA11A11);
            const tint = {
                r: 0.92 + this._smoothRandom(surfaceX, surfaceY, 0x0BADC0DE) * 0.18,
                g: 0.95 + this._smoothRandom(surfaceX, surfaceY, 0x0BADC159) * 0.12,
                b: 0.90 + this._smoothRandom(surfaceX, surfaceY, 0x0BADC294) * 0.20
            };
            const wallLight = this._localLight(hitWorldX, hitWorldY, light);

            for (let y = drawStart; y <= drawEnd; y++) {
                // Measure from the projected top of the wall. `horizon` already
                // includes the screen midpoint, so subtracting h / 2 again made
                // the texture's vertical origin vary with distance.
                const d = (y - horizon) * 256 + lineHeight * 128;
                const texY = ((d * this.wallH) / lineHeight / 256) | 0;

                let [r, g, b] = this._sample(this.wallPx, this.wallW, this.wallH, texX, texY);

                const sideShade = side ? 0.85 : 1.0;
                const streak = 0.92 + 0.16 * rand01FromI(hash32(0x51EEAD ^ (texY * 131)));

                let shade = sideShade * wallLight * streak * grime;
                r = (r * shade) | 0; g = (g * shade) | 0; b = (b * shade) | 0;

                ;[r, g, b] = this._applyTint(r, g, b, tint);
                ;[r, g, b] = this._mixFog(r, g, b, perpWallDist);

                const idx = (y * w + x) * 4;
                this.buf[idx] = r; this.buf[idx + 1] = g; this.buf[idx + 2] = b; this.buf[idx + 3] = 255;
            }
        }

        // Draw every billboard once, from farthest to nearest, after the wall
        // depth buffer is complete so props occlude one another correctly.
        const billboards = [];
        for (const entity of state.entities || []) {
            if (!entity.active) continue;
            const animation = this.entityAnimations[entity.type];
            if (!animation?.frames.length) continue;
            const elapsedFrames = Math.floor(
                time * 0.001 * entity.animationFps + entity.animationPhase
            );
            const frame = animation.frames[
                ((elapsedFrames % animation.frames.length) + animation.frames.length) %
                animation.frames.length
            ];
            billboards.push({
                px: frame.px, w: frame.w, h: frame.h,
                x: entity.x,
                y: entity.y,
                scale: entity.scale * (state.entityGroupScale ?? 1)
            });
        }
        if (this.exitSprites?.portal && state.exit) {
            const sprite = this.exitSprites.portal;
            billboards.push({
                px: sprite.px, w: sprite.w, h: sprite.h,
                x: state.exit.x, y: state.exit.y,
                scale: 1.08,
                emissive: true
            });
        }
        for (const sign of state.exitSigns || []) {
            const toExitX = sign.targetX - sign.x;
            const toExitY = sign.targetY - sign.y;
            const forward = dirX * toExitX + dirY * toExitY;
            const right = dirY * toExitX - dirX * toExitY;
            const direction = forward > Math.abs(right) * 0.7
                ? 'forward'
                : right >= 0 ? 'right' : 'left';
            const sprite = this.exitSprites?.[direction];
            if (!sprite) continue;
            billboards.push({
                px: sprite.px, w: sprite.w, h: sprite.h,
                x: sign.x, y: sign.y,
                scale: sign.scale,
                emissive: true
            });
        }
        for (const prop of state.props || []) {
            const sprite = this.decorationSprites?.[prop.type];
            if (!sprite) continue;
            billboards.push({
                px: sprite.px, w: sprite.w, h: sprite.h,
                x: prop.x, y: prop.y, scale: prop.scale
            });
        }
        billboards.sort((a, b) => {
            const distanceA = (a.x - posX) ** 2 + (a.y - posY) ** 2;
            const distanceB = (b.x - posX) ** 2 + (b.y - posY) ** 2;
            return distanceB - distanceA;
        });
        for (const billboard of billboards) {
            this.drawBillboard(
                billboard.px, billboard.w, billboard.h,
                billboard.x, billboard.y, state, billboard.scale,
                billboard.emissive || false
            );
        }

        this._applyVhsOverlay(time);
        this._applyFallOverlay(fallAmount);
        this._applyExitOverlay(exitAmount);

        // commit
        this.ctx.putImageData(this.imageData, 0, 0);
        this.out.draw(0, 0, this.canvas);
        this.out.refresh();
    }
    drawBillboard(spritePx, sw, sh, entX, entY, state, scale = 1, emissive = false) {
        const { posX, posY, dirX, dirY, planeX, planeY, pitch, light } = state;
        const w = this.w, h = this.h;
        const horizon = ((h / 2) | 0) + (pitch | 0);

        // position relative to camera
        const relX = entX - posX;
        const relY = entY - posY;

        // camera transform (classic raycaster sprite math)
        const invDet = 1.0 / (planeX * dirY - dirX * planeY);
        const transformX = invDet * (dirY * relX - dirX * relY);
        const transformY = invDet * (-planeY * relX + planeX * relY); // depth

        if (transformY <= 0.05) return; // behind/too close

        const spriteScreenX = ((w / 2) * (1 + transformX / transformY)) | 0;

        // Scale props relative to a full wall and preserve source aspect ratio.
        // Their lower edge stays on the floor rather than floating at eye level.
        const fullWallH = Math.abs(h / transformY);
        const spriteH = Math.max(1, fullWallH * scale);
        const spriteW = Math.max(1, spriteH * (sw / sh));
        const floorScreenY = horizon + fullWallH * 0.5;
        const unclippedStartY = floorScreenY - spriteH;
        const unclippedStartX = spriteScreenX - spriteW * 0.5;

        let drawStartY = unclippedStartY | 0;
        let drawEndY = floorScreenY | 0;
        drawStartY = Math.max(0, drawStartY);
        drawEndY = Math.min(h - 1, drawEndY);

        let drawStartX = unclippedStartX | 0;
        let drawEndX = (unclippedStartX + spriteW) | 0;
        drawStartX = Math.max(0, drawStartX);
        drawEndX = Math.min(w - 1, drawEndX);

        // shade / fog for sprite
        const dist = transformY;
        const fogK = Math.min(1, dist / 16);
        const flash = 1.0; // if you later add flashlight, multiply here
        const localLight = this._localLight(entX, entY, light);
        const shadeBase = emissive
            ? Math.max(0.62, 1.05 / (1.0 + dist * 0.035))
            : (0.95 / (1.0 + dist * 0.10)) * localLight * flash;

        for (let stripe = drawStartX; stripe <= drawEndX; stripe++) {
            // occlusion test per column
            if (this.zBuffer && dist >= this.zBuffer[stripe]) continue;

            const texX = (((stripe - unclippedStartX) * sw) / spriteW) | 0;

            for (let y = drawStartY; y <= drawEndY; y++) {
                const texY = (((y - unclippedStartY) * sh) / spriteH) | 0;

                // sample sprite
                const u = ((texX % sw) + sw) % sw;
                const v = ((texY % sh) + sh) % sh;
                const si = (v * sw + u) * 4;

                const a = spritePx[si + 3];
                if (a < 10) continue; // transparent

                let r = spritePx[si], g = spritePx[si + 1], b = spritePx[si + 2];

                // shade
                r = (r * shadeBase) | 0;
                g = (g * shadeBase) | 0;
                b = (b * shadeBase) | 0;

                // fog mix
                r = (r * (1 - fogK) + this.fogColor.r * fogK) | 0;
                g = (g * (1 - fogK) + this.fogColor.g * fogK) | 0;
                b = (b * (1 - fogK) + this.fogColor.b * fogK) | 0;

                const idx = (y * w + stripe) * 4;

                // alpha blend onto existing pixel
                const alpha = a / 255;
                this.buf[idx] = (this.buf[idx] * (1 - alpha) + r * alpha) | 0;
                this.buf[idx + 1] = (this.buf[idx + 1] * (1 - alpha) + g * alpha) | 0;
                this.buf[idx + 2] = (this.buf[idx + 2] * (1 - alpha) + b * alpha) | 0;
                this.buf[idx + 3] = 255;
            }
        }
    }

}
