import {
    ChunkedMap,
    HALF_WALL_THICKNESS,
    TILE,
    hash32
} from "./ChunkedMap.js";
import { Raycaster } from "./Raycaster.js";

export default class MainScene extends Phaser.Scene {
    preload() {
        this.load.image('wall', 'assets/wall-v2.png');
        this.load.image('floor', 'assets/floor-v2.png');
        this.load.image('ceiling', 'assets/ceiling-v2.png');
        this.load.image('entityRunnerSheet', 'assets/entity-runner-sheet.png');
        this.load.image('entityStalkerSheet', 'assets/entity-stalker-sheet.png');
        this.load.image('exitSunnyMeadow', 'assets/exit-sunny-meadow.png');
        this.load.image('officeFurniture', 'assets/office-furniture.png');
        this.load.image('labWorkstation', 'assets/lab-workstation.png');
    }

    create() {
        this.baseSeed = 1337;
        this.level = 0;
        this.fallTransition = null;
        this.exitTransition = null;
        this.map = new ChunkedMap({ chunkSize: 24, keepRadius: 3, seed: this.baseSeed });
        this.exit = this.map.getExit();
        this.exitSigns = [];

        this.posX = 12.5;
        this.posY = 12.5;
        this.dirX = 0;
        this.dirY = 1;
        this.planeX = 0.66;
        this.planeY = 0;
        this.pitch = 0;
        this.entityGroup = {
            scale: 1,
            counts: { runner: 1, stalker: 1 },
            members: []
        };

        this.keys = this.input.keyboard.addKeys('W,A,S,D,SHIFT');
        this.input.on('pointerdown', () => this.input.mouse.requestPointerLock());
        this.input.mouse.disableContextMenu();

        this.input.on('pointermove', (p) => {
            if (!this.input.mouse.locked) return;
            const sens = 0.0022;
            const dx = p.movementX;
            const dy = p.movementY;

            const rot = -dx * sens;
            const oldDirX = this.dirX;
            this.dirX = this.dirX * Math.cos(rot) - this.dirY * Math.sin(rot);
            this.dirY = oldDirX * Math.sin(rot) + this.dirY * Math.cos(rot);

            const oldPlaneX = this.planeX;
            this.planeX = this.planeX * Math.cos(rot) - this.planeY * Math.sin(rot);
            this.planeY = oldPlaneX * Math.sin(rot) + this.planeY * Math.cos(rot);

            this.pitch = Phaser.Math.Clamp(this.pitch - dy * 0.25, -120, 120);
        });

        const vw = 360, vh = 220;
        const wallImg = this.textures.get('wall').getSourceImage();
        const floorImg = this.textures.get('floor').getSourceImage();
        const ceilImg = this.textures.get('ceiling').getSourceImage();

        this.ray = new Raycaster(
            this,
            vw, vh,
            { wall: wallImg, floor: floorImg, ceil: ceilImg },
            (wx, wy) => this.map.isSolidAt(wx, wy),
            (wx, wy, margin = 0) => this.map.isInLargeRoom(wx, wy, margin),
            (wx, wy) => this.map.isHoleAt(wx, wy)
        );

        this.ray.resizeToScreen();
        this.scale.on('resize', () => this.ray.resizeToScreen());

        this.light = 1.0;
        this.nextFlicker = 0;
        this.ray.entityAnimations = {
            runner: this.readSpriteSheetFrames('entityRunnerSheet', 4, 2),
            stalker: this.readSpriteSheetFrames('entityStalkerSheet', 4, 2)
        };
        this.ray.exitSprites = this.createExitSprites();
        this.ray.decorationSprites = {
            office: this.readTexturePixels('officeFurniture'),
            lab: this.readTexturePixels('labWorkstation')
        };
        this.props = this.map.getDecorationsAround(this.posX, this.posY);
        this.ensurePlayerInOpenSpace();
        this.props = this.map.getDecorationsAround(this.posX, this.posY);
        this.rebuildEntityGroup();

        this.createMinimap();

    }

    readTexturePixels(textureKey) {
        const image = this.textures.get(textureKey).getSourceImage();
        const canvas = document.createElement('canvas');
        canvas.width = image.width;
        canvas.height = image.height;
        const context = canvas.getContext('2d');
        context.drawImage(image, 0, 0);
        return {
            px: context.getImageData(0, 0, image.width, image.height).data,
            w: image.width,
            h: image.height
        };
    }

    readSpriteSheetFrames(textureKey, columns, rows) {
        const image = this.textures.get(textureKey).getSourceImage();
        const frameW = Math.floor(image.width / columns);
        const frameH = Math.floor(image.height / rows);
        const canvas = document.createElement('canvas');
        canvas.width = image.width;
        canvas.height = image.height;
        const context = canvas.getContext('2d');
        context.drawImage(image, 0, 0);
        const frames = [];

        for (let row = 0; row < rows; row++) {
            for (let column = 0; column < columns; column++) {
                frames.push({
                    px: context.getImageData(
                        column * frameW,
                        row * frameH,
                        frameW,
                        frameH
                    ).data,
                    w: frameW,
                    h: frameH
                });
            }
        }
        return { frames, frameW, frameH };
    }

    canvasToPixels(canvas) {
        const context = canvas.getContext('2d');
        return {
            px: context.getImageData(0, 0, canvas.width, canvas.height).data,
            w: canvas.width,
            h: canvas.height
        };
    }

    createExitSprites() {
        const makeCanvas = () => {
            const canvas = document.createElement('canvas');
            canvas.width = 192;
            canvas.height = 256;
            return canvas;
        };
        const drawArrow = (context, direction) => {
            context.save();
            context.translate(96, 91);
            if (direction === 'left') context.rotate(-Math.PI / 2);
            if (direction === 'right') context.rotate(Math.PI / 2);
            context.fillStyle = '#eaffd8';
            context.beginPath();
            context.moveTo(0, -22);
            context.lineTo(22, 1);
            context.lineTo(8, 1);
            context.lineTo(8, 23);
            context.lineTo(-8, 23);
            context.lineTo(-8, 1);
            context.lineTo(-22, 1);
            context.closePath();
            context.fill();
            context.restore();
        };
        const makeSign = (direction) => {
            const canvas = makeCanvas();
            const context = canvas.getContext('2d');
            context.fillStyle = '#102b18';
            context.fillRect(24, 28, 144, 94);
            context.strokeStyle = '#aef5a0';
            context.lineWidth = 5;
            context.strokeRect(24, 28, 144, 94);
            context.fillStyle = '#eaffd8';
            context.font = 'bold 28px Arial';
            context.textAlign = 'center';
            context.textBaseline = 'middle';
            context.fillText('EXIT', 96, 51);
            drawArrow(context, direction);
            return this.canvasToPixels(canvas);
        };

        const portalCanvas = makeCanvas();
        const portal = portalCanvas.getContext('2d');
        const meadow = this.textures.get('exitSunnyMeadow').getSourceImage();
        const glow = portal.createLinearGradient(0, 20, 0, 250);
        glow.addColorStop(0, '#d8ffd0');
        glow.addColorStop(0.15, '#48d66a');
        glow.addColorStop(1, '#163d22');
        portal.fillStyle = glow;
        portal.fillRect(28, 18, 136, 238);

        // Center-crop the bright landscape into the narrow open doorway.
        const doorwayX = 40;
        const doorwayY = 52;
        const doorwayW = 112;
        const doorwayH = 204;
        const targetAspect = doorwayW / doorwayH;
        const sourceAspect = meadow.width / meadow.height;
        let sourceX = 0;
        let sourceY = 0;
        let sourceW = meadow.width;
        let sourceH = meadow.height;
        if (sourceAspect > targetAspect) {
            sourceW = meadow.height * targetAspect;
            sourceX = (meadow.width - sourceW) * 0.5;
        } else {
            sourceH = meadow.width / targetAspect;
            sourceY = (meadow.height - sourceH) * 0.5;
        }
        portal.drawImage(
            meadow,
            sourceX, sourceY, sourceW, sourceH,
            doorwayX, doorwayY, doorwayW, doorwayH
        );

        // A pale veil keeps the exterior looking unnaturally bright against
        // the dim interior without hiding the path and meadow details.
        portal.fillStyle = 'rgba(222, 255, 207, 0.12)';
        portal.fillRect(doorwayX, doorwayY, doorwayW, doorwayH);
        portal.strokeStyle = '#d8ffd0';
        portal.lineWidth = 5;
        portal.strokeRect(28, 18, 136, 238);
        portal.fillStyle = '#eaffd8';
        portal.font = 'bold 27px Arial';
        portal.textAlign = 'center';
        portal.textBaseline = 'middle';
        portal.fillText('EXIT', 96, 36);

        return {
            left: makeSign('left'),
            right: makeSign('right'),
            forward: makeSign('forward'),
            portal: this.canvasToPixels(portalCanvas)
        };
    }

    createMinimap() {
        this.minimap = this.add.graphics().setDepth(1000).setScrollFactor(0);
        this.minimapRadius = 10;
        this.minimapCellSize = 6;
    }

    drawMinimap() {
        const graphics = this.minimap;
        const radius = this.minimapRadius;
        const cellSize = this.minimapCellSize;
        const size = radius * 2 * cellSize;
        const left = this.scale.width - size - 16;
        const top = 16;
        const centerX = left + size / 2;
        const centerY = top + size / 2;
        const startX = Math.floor(this.posX - radius);
        const endX = Math.ceil(this.posX + radius);
        const startY = Math.floor(this.posY - radius);
        const endY = Math.ceil(this.posY + radius);

        graphics.setAlpha(1 - Math.max(
            this.fallTransition?.amount || 0,
            this.exitTransition?.amount || 0
        ));
        graphics.clear();
        graphics.fillStyle(0x080b0d, 0.82);
        graphics.fillRect(left, top, size, size);

        // Keep the map fixed to the world while the player remains centered.
        graphics.fillStyle(0xc2b77a, 0.82);
        for (let worldY = startY; worldY < endY; worldY++) {
            for (let worldX = startX; worldX < endX; worldX++) {
                const tile = this.map.getTile(worldX, worldY);
                if (!tile) continue;

                const x = centerX + (worldX - this.posX) * cellSize;
                const y = centerY + (worldY - this.posY) * cellSize;
                if (tile === TILE.HOLE) {
                    const inset = cellSize * 0.1;
                    graphics.fillStyle(0x010204, 1);
                    graphics.fillRect(
                        x + inset,
                        y + inset,
                        cellSize - inset * 2,
                        cellSize - inset * 2
                    );
                    graphics.lineStyle(1, 0x655936, 0.9);
                    graphics.strokeRect(
                        x + inset,
                        y + inset,
                        cellSize - inset * 2,
                        cellSize - inset * 2
                    );
                    graphics.fillStyle(0xc2b77a, 0.82);
                    continue;
                }

                let wallX = x;
                let wallY = y;
                let wallW = cellSize;
                let wallH = cellSize;
                if (tile === TILE.HALF_VERTICAL_LEFT) wallW *= HALF_WALL_THICKNESS;
                if (tile === TILE.HALF_VERTICAL_RIGHT) {
                    wallX += wallW * (1 - HALF_WALL_THICKNESS);
                    wallW *= HALF_WALL_THICKNESS;
                }
                if (tile === TILE.HALF_HORIZONTAL_TOP) wallH *= HALF_WALL_THICKNESS;
                if (tile === TILE.HALF_HORIZONTAL_BOTTOM) {
                    wallY += wallH * (1 - HALF_WALL_THICKNESS);
                    wallH *= HALF_WALL_THICKNESS;
                }

                const clippedLeft = Math.max(wallX, left);
                const clippedTop = Math.max(wallY, top);
                const clippedRight = Math.min(wallX + wallW, left + size);
                const clippedBottom = Math.min(wallY + wallH, top + size);
                if (clippedRight > clippedLeft && clippedBottom > clippedTop) {
                    graphics.fillRect(
                        clippedLeft,
                        clippedTop,
                        clippedRight - clippedLeft,
                        clippedBottom - clippedTop
                    );
                }
            }
        }

        // The level exit, when it is inside the minimap's visible area.
        const exitX = centerX + (this.exit.x - this.posX) * cellSize;
        const exitY = centerY + (this.exit.y - this.posY) * cellSize;
        if (exitX >= left && exitX <= left + size && exitY >= top && exitY <= top + size) {
            graphics.fillStyle(0x74ff82, 1);
            graphics.fillRect(exitX - 3, exitY - 3, 6, 6);
            graphics.lineStyle(1, 0xe4ffdd, 1);
            graphics.strokeRect(exitX - 3, exitY - 3, 6, 6);
        }

        // Entity markers, when they are inside the minimap's visible area.
        for (const entity of this.entityGroup.members) {
            if (!entity.active) continue;
            const entityX = centerX + (entity.x - this.posX) * cellSize;
            const entityY = centerY + (entity.y - this.posY) * cellSize;
            if (entityX >= left && entityX <= left + size && entityY >= top && entityY <= top + size) {
                graphics.fillStyle(entity.type === 'runner' ? 0xe45742 : 0xa83333, 1);
                graphics.fillCircle(entityX, entityY, entity.type === 'runner' ? 2.2 : 2.7);
            }
        }

        // Player and facing direction.
        const tipX = centerX + this.dirX * 7;
        const tipY = centerY + this.dirY * 7;
        const sideX = -this.dirY * 3.5;
        const sideY = this.dirX * 3.5;
        graphics.fillStyle(0xffef80, 1);
        graphics.fillTriangle(
            tipX, tipY,
            centerX - this.dirX * 3 + sideX, centerY - this.dirY * 3 + sideY,
            centerX - this.dirX * 3 - sideX, centerY - this.dirY * 3 - sideY
        );

        graphics.lineStyle(2, 0xe8dfb1, 0.9);
        graphics.strokeRect(left, top, size, size);
    }

    canMove(nx, ny) {
        const r = 0.20;
        if (this.isDecorationBlocked(nx, ny, r)) return false;
        const checks = [
            [nx + r, ny], [nx - r, ny],
            [nx, ny + r], [nx, ny - r],
            [nx + r * 0.7, ny + r * 0.7],
            [nx - r * 0.7, ny + r * 0.7],
            [nx + r * 0.7, ny - r * 0.7],
            [nx - r * 0.7, ny - r * 0.7],
        ];
        for (const [x, y] of checks) {
            if (this.map.isSolidAt(x, y)) return false;
        }
        return true;
    }

    isDecorationBlocked(x, y, radius = 0.2) {
        for (const prop of this.props || []) {
            if (Math.hypot(x - prop.x, y - prop.y) < radius + prop.radius) return true;
        }
        return false;
    }

    isWallBlocked(x, y, radius = 0.2) {
        const diagonal = radius * 0.707;
        const checks = [
            [x, y],
            [x + radius, y], [x - radius, y],
            [x, y + radius], [x, y - radius],
            [x + diagonal, y + diagonal], [x - diagonal, y + diagonal],
            [x + diagonal, y - diagonal], [x - diagonal, y - diagonal]
        ];
        return checks.some(([sampleX, sampleY]) =>
            this.map.isSolidAt(sampleX, sampleY) ||
            this.map.isHoleAt(sampleX, sampleY)
        );
    }

    ensurePlayerInOpenSpace() {
        const radius = 0.2;
        if (!this.isWallBlocked(this.posX, this.posY, radius) &&
            !this.isDecorationBlocked(this.posX, this.posY, radius)) return;

        const originX = this.posX;
        const originY = this.posY;
        for (let ring = 0; ring <= 24; ring++) {
            const steps = ring === 0 ? 1 : Math.max(8, ring * 8);
            const distance = ring * 0.5;
            for (let step = 0; step < steps; step++) {
                const angle = steps === 1 ? 0 : (step / steps) * Math.PI * 2;
                const x = originX + Math.cos(angle) * distance;
                const y = originY + Math.sin(angle) * distance;
                if (this.isWallBlocked(x, y, radius)) continue;
                if (this.isDecorationBlocked(x, y, radius)) continue;
                this.posX = x;
                this.posY = y;
                return;
            }
        }
    }

    isEntityBlocked(x, y, radius, ignoredEntity = null) {
        return this.entityGroup.members.some(entity =>
            entity !== ignoredEntity &&
            entity.active &&
            Math.hypot(x - entity.x, y - entity.y) <
                radius + entity.radius * this.entityGroup.scale
        );
    }

    ensureEntityInOpenSpace(entity) {
        if (!entity?.active) return;
        const radius = entity.radius * this.entityGroup.scale;
        if (!this.isWallBlocked(entity.x, entity.y, radius) &&
            !this.isDecorationBlocked(entity.x, entity.y, radius) &&
            !this.isEntityBlocked(entity.x, entity.y, radius, entity)) return;

        const originX = entity.x;
        const originY = entity.y;
        for (let ring = 1; ring <= 24; ring++) {
            const steps = Math.max(8, ring * 8);
            const distance = ring * 0.5;
            for (let step = 0; step < steps; step++) {
                const angle = (step / steps) * Math.PI * 2;
                const x = originX + Math.cos(angle) * distance;
                const y = originY + Math.sin(angle) * distance;
                if (Math.hypot(x - this.posX, y - this.posY) < 3) continue;
                if (this.isWallBlocked(x, y, radius)) continue;
                if (this.isDecorationBlocked(x, y, radius)) continue;
                if (this.isEntityBlocked(x, y, radius, entity)) continue;
                entity.x = x;
                entity.y = y;
                return;
            }
        }
    }

    rebuildEntityGroup() {
        const members = [];
        const definitions = [
            {
                type: 'stalker',
                count: this.entityGroup.counts.stalker,
                speed: 0.48,
                animationFps: 5,
                scale: 1.08,
                radius: 0.24
            },
            {
                type: 'runner',
                count: this.entityGroup.counts.runner,
                speed: 0.82,
                animationFps: 9,
                scale: 0.82,
                radius: 0.28
            }
        ];
        const total = definitions.reduce((sum, definition) => sum + definition.count, 0);
        let memberIndex = 0;

        for (const definition of definitions) {
            for (let index = 0; index < definition.count; index++) {
                const angle = (memberIndex / Math.max(1, total)) * Math.PI * 2 + 0.45;
                const distance = 8 + (memberIndex % 3) * 2.25;
                members.push({
                    id: `${definition.type}-${index}`,
                    type: definition.type,
                    x: this.posX + Math.cos(angle) * distance,
                    y: this.posY + Math.sin(angle) * distance,
                    speed: definition.speed,
                    animationFps: definition.animationFps,
                    animationPhase: memberIndex * 2,
                    scale: definition.scale,
                    radius: definition.radius,
                    active: true
                });
                memberIndex++;
            }
        }

        this.entityGroup.members = members;
        for (const entity of members) this.ensureEntityInOpenSpace(entity);
    }

    setEntityGroupScale(scale) {
        this.entityGroup.scale = Phaser.Math.Clamp(scale, 0.25, 3);
        for (const entity of this.entityGroup.members) {
            this.ensureEntityInOpenSpace(entity);
        }
    }

    setEntityGroupCounts({ runner, stalker }) {
        if (runner !== undefined) {
            this.entityGroup.counts.runner = Phaser.Math.Clamp(Math.floor(runner), 0, 24);
        }
        if (stalker !== undefined) {
            this.entityGroup.counts.stalker = Phaser.Math.Clamp(Math.floor(stalker), 0, 24);
        }
        this.rebuildEntityGroup();
    }

    moveEntity(entity, dt) {
        if (!entity.active) return;
        this.ensureEntityInOpenSpace(entity);
        const radius = entity.radius * this.entityGroup.scale;

        // creep toward player with a little wander
        const dx = this.posX - entity.x;
        const dy = this.posY - entity.y;
        const d = Math.hypot(dx, dy);

        // if too close, stop (you can add jumpscare here)
        if (d < 1.2) return;

        // simple steer + jitter
        const nx = dx / (d || 1);
        const ny = dy / (d || 1);
        const jitter = (Math.random() - 0.5) * 0.15;

        const tx = entity.x + (nx + jitter) * entity.speed * dt;
        const ty = entity.y + (ny - jitter) * entity.speed * dt;

        // collide against walls (same map as player)
        if (!this.isWallBlocked(tx, entity.y, radius) &&
            !this.isDecorationBlocked(tx, entity.y, radius) &&
            !this.isEntityBlocked(tx, entity.y, radius, entity)) {
            entity.x = tx;
        }
        if (!this.isWallBlocked(entity.x, ty, radius) &&
            !this.isDecorationBlocked(entity.x, ty, radius) &&
            !this.isEntityBlocked(entity.x, ty, radius, entity)) {
            entity.y = ty;
        }
    }

    moveEntities(dt) {
        for (const entity of this.entityGroup.members) this.moveEntity(entity, dt);
    }

    beginFall() {
        if (this.fallTransition) return;
        this.fallTransition = {
            elapsed: 0,
            duration: 1.35,
            swapped: false,
            amount: 0,
            startPitch: this.pitch
        };
    }

    beginExit() {
        if (this.exitTransition || this.fallTransition) return;
        this.exitTransition = {
            elapsed: 0,
            duration: 1.0,
            swapped: false,
            amount: 0
        };
    }

    descendToNextMap() {
        this.level++;
        const nextSeed = hash32(this.baseSeed ^ Math.imul(this.level, 0x45d9f3b));
        this.map = new ChunkedMap({ chunkSize: 24, keepRadius: 3, seed: nextSeed });
        this.exit = this.map.getExit();
        this.exitSigns = [];

        this.posX = 12.5;
        this.posY = 12.5;
        this.props = [];
        this.ensurePlayerInOpenSpace();
        this.props = this.map.getDecorationsAround(this.posX, this.posY);
        this.ensurePlayerInOpenSpace();
        this.props = this.map.getDecorationsAround(this.posX, this.posY);

        this.rebuildEntityGroup();
    }

    updateFall(dt) {
        const transition = this.fallTransition;
        if (!transition) return;

        transition.elapsed = Math.min(transition.duration, transition.elapsed + dt);
        const progress = transition.elapsed / transition.duration;
        transition.amount = Math.sin(progress * Math.PI);

        if (progress < 0.5) {
            this.pitch = Phaser.Math.Clamp(
                transition.startPitch + progress * 180,
                -120,
                120
            );
        } else {
            if (!transition.swapped) {
                this.descendToNextMap();
                transition.swapped = true;
            }
            this.pitch = Phaser.Math.Clamp((1 - progress) * 120, -120, 120);
        }

        if (transition.elapsed >= transition.duration) {
            this.pitch = 0;
            this.fallTransition = null;
        }
    }

    updateExit(dt) {
        const transition = this.exitTransition;
        if (!transition) return;

        transition.elapsed = Math.min(transition.duration, transition.elapsed + dt);
        const progress = transition.elapsed / transition.duration;
        transition.amount = Math.sin(progress * Math.PI);
        if (progress >= 0.5 && !transition.swapped) {
            this.descendToNextMap();
            transition.swapped = true;
        }
        if (transition.elapsed >= transition.duration) {
            this.exitTransition = null;
        }
    }

    update(time, delta) {
        const dt = Math.min(0.033, delta / 1000);

        this.map.ensureAround(this.posX, this.posY);
        this.props = this.map.getDecorationsAround(this.posX, this.posY);
        this.exitSigns = this.map.getExitSignsAround(this.posX, this.posY);

        const base = this.keys.SHIFT.isDown ? 4.9 : 3.2;
        const moveSpeed = base * dt;
        const strafeSpeed = moveSpeed * 0.85;
        const canControl = !this.fallTransition && !this.exitTransition;

        if (canControl && this.keys.W.isDown) {
            const nx = this.posX + this.dirX * moveSpeed;
            const ny = this.posY + this.dirY * moveSpeed;
            if (this.canMove(nx, this.posY)) this.posX = nx;
            if (this.canMove(this.posX, ny)) this.posY = ny;
        }
        if (canControl && this.keys.S.isDown) {
            const nx = this.posX - this.dirX * moveSpeed;
            const ny = this.posY - this.dirY * moveSpeed;
            if (this.canMove(nx, this.posY)) this.posX = nx;
            if (this.canMove(this.posX, ny)) this.posY = ny;
        }

        const perpX = this.dirY;
        const perpY = -this.dirX;
        if (canControl && this.keys.D.isDown) {
            const nx = this.posX + perpX * strafeSpeed;
            const ny = this.posY + perpY * strafeSpeed;
            if (this.canMove(nx, this.posY)) this.posX = nx;
            if (this.canMove(this.posX, ny)) this.posY = ny;
        }
        if (canControl && this.keys.A.isDown) {
            const nx = this.posX - perpX * strafeSpeed;
            const ny = this.posY - perpY * strafeSpeed;
            if (this.canMove(nx, this.posY)) this.posX = nx;
            if (this.canMove(this.posX, ny)) this.posY = ny;
        }

        if (time > this.nextFlicker) {
            this.nextFlicker = time + 250 + Math.random() * 1200;
            const dip = Math.random() < 0.6;
            this.light = dip ? (0.45 + Math.random() * 0.35) : (0.9 + Math.random() * 0.2);
            setTimeout(() => this.light = 1.0, 60 + Math.random() * 200);
        }
        if (!this.fallTransition && !this.exitTransition &&
            this.map.isHoleAt(this.posX, this.posY)) {
            this.beginFall();
        }
        if (!this.fallTransition && !this.exitTransition &&
            this.map.isExitAt(this.posX, this.posY)) {
            this.beginExit();
        }
        if (this.fallTransition) this.updateFall(dt);
        else if (this.exitTransition) this.updateExit(dt);
        else this.moveEntities(dt);

        this.ray.render({
            posX: this.posX, posY: this.posY,
            dirX: this.dirX, dirY: this.dirY,
            planeX: this.planeX, planeY: this.planeY,
            pitch: this.pitch,
            light: this.light,
            time,
            fallAmount: this.fallTransition?.amount || 0,
            exitAmount: this.exitTransition?.amount || 0,
            entities: this.entityGroup.members,
            entityGroupScale: this.entityGroup.scale,
            exit: this.exit,
            exitSigns: this.exitSigns,
            props: this.props
        });
        this.drawMinimap();
    }
}
