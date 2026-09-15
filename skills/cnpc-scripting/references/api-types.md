# CNPC Scripting API Type Definitions (1.20.1)

This file contains the full TypeScript-style API declarations for CustomNPCs 1.20.1.
Only loaded on-demand when the agent needs to look up specific API methods/classes.

## Event Handler Naming Convention

Event handler function names are derived from the event class name:
1. Take the event class name (e.g., "ButtonEvent", "TimerEvent", "UpdateEvent")
2. Remove the "Event" suffix
3. Convert to camelCase (lowercase first letter)

Examples:
- `BlockEvent.TimerEvent` → `function timer(event) {}`
- `PlayerEvent.UpdateEvent` → `function tick(event) {}` (special case)
- `NpcEvent.InteractEvent` → `function interact(event) {}`
- `CustomGuiEvent.ButtonEvent` → `function customGuiButton(event) {}`
- `CustomGuiEvent.SlotClickEvent` → `function customGuiSlotClicked(event) {}`

## Core Types

```typescript
declare class IContainer {
    getSize(): Number
    getSlot(slot: Number): IItemStack
    setSlot(slot: Number, item: IItemStack): void
    getMCInventory(): IInventory
    getMCContainer(): Container
    count(item: IItemStack, ignoreDamage: boolean, ignoreNBT: boolean): Number
    getItems(): IItemStack[]
}

declare class IContainerCustomChest extends IContainer {
    setName(name: String): void
    getName(): String
}

declare class IDamageSource {
    getType(): String
    isUnblockable(): boolean
    isProjectile(): boolean
    getTrueSource(): IEntity
    getImmediateSource(): IEntity
    getMCDamageSource(): DamageSource
}

declare class IDimension {
    getId(): Number
    getName(): String
    getSuffix(): String
}

declare class INbt {
    remove(key: String): void
    has(key: String): boolean
    getBoolean(key: String): boolean
    setBoolean(key: String, value: boolean): void
    getShort(key: String): short
    setShort(key: String, value: short): void
    getInteger(key: String): Number
    setInteger(key: String, value: Number): void
    getByte(key: String): byte
    setByte(key: String, value: byte): void
    getLong(key: String): Number
    setLong(key: String, value: Number): void
    getDouble(key: String): Number
    setDouble(key: String, value: Number): void
    getFloat(key: String): Number
    setFloat(key: String, value: Number): void
    getString(key: String): String
    putString(key: String, value: String): void
    getByteArray(key: String): byte
    setByteArray(key: String, value: byte[]): void
    getIntegerArray(key: String): Number
    setIntegerArray(key: String, value: int[]): void
    getList(key: String, type: Number): Object
    getListType(key: String): Number
    setList(key: String, value: Object[]): void
    getCompound(key: String): INbt
    setCompound(key: String, value: INbt): void
    getKeys(): String[]
    getType(key: String): Number
    getMCNBT(): NBTTagCompound
    toJsonString(): String
    isEqual(nbt: INbt): boolean
    clear(): void
    isEmpty(): boolean
    merge(nbt: INbt): void
    mcSetTag(key: String, base: NBTBase): void
    mcGetTag(key: String): NBTBase
}

declare class IPos {
    getX(): number
    getY(): number
    getZ(): number
    up(): IPos
    up(n: Number): IPos
    down(): IPos
    down(n: Number): IPos
    north(): IPos
    north(n: Number): IPos
    east(): IPos
    east(n: Number): IPos
    south(): IPos
    south(n: Number): IPos
    west(): IPos
    west(n: Number): IPos
    add(x: Number, y: Number, z: Number): IPos
    add(pos: IPos): IPos
    subtract(x: Number, y: Number, z: Number): IPos
    subtract(pos: IPos): IPos
    normalize(): Number
    getMCBlockPos(): BlockPos
    offset(direction: Number): IPos
    offset(direction: Number, n: Number): IPos
    distanceTo(pos: IPos): Number
}

declare class IRayTrace {
    getPos(): IPos
    getBlock(): IBlock
    getSideHit(): Number
}

declare class IData {
    put(key: String, value: Object): void
    get(key: String): Object
    remove(key: String): void
    has(key: String): boolean
    getKeys(): String[]
    clear(): void
}

declare class ITimers {
    start(id: Number, ticks: Number, repeat: boolean): void
    forceStart(id: Number, ticks: Number, repeat: boolean): void
    has(id: Number): boolean
    stop(id: Number): boolean
    reset(id: Number): void
    clear(): void
}

declare class IScoreboard {
    getObjectives(): IScoreboardObjective[]
    getObjective(name: String): IScoreboardObjective
    hasObjective(objective: String): boolean
    removeObjective(objective: String): void
    addObjective(objective: String, criteria: String): IScoreboardObjective
    setPlayerScore(player: String, objective: String, score: Number, datatag: String): void
    getPlayerScore(player: String, objective: String, datatag: String): Number
    hasPlayerObjective(player: String, objective: String, datatag: String): boolean
    deletePlayerScore(player: String, objective: String, datatag: String): void
    getTeams(): IScoreboardTeam[]
    hasTeam(name: String): boolean
    addTeam(name: String): IScoreboardTeam
    getTeam(name: String): IScoreboardTeam
    removeTeam(name: String): void
    getPlayerTeam(player: String): IScoreboardTeam
    removePlayerTeam(player: String): void
    getPlayerList(): String
}

declare class IScoreboardObjective {
    getName(): String
    getDisplayName(): String
    setDisplayName(name: String): void
    getCriteria(): String
    isReadyOnly(): boolean
    getScores(): IScoreboardScore[]
    getScore(player: String): IScoreboardScore
    hasScore(player: String): boolean
    createScore(player: String): IScoreboardScore
    removeScore(player: String): void
}

declare class IScoreboardScore {
    getValue(): Number
    setValue(val: Number): void
    getPlayerName(): String
}

declare class IScoreboardTeam {
    getName(): String
    getDisplayName(): String
    setDisplayName(name: String): void
    addPlayer(player: String): void
    hasPlayer(player: String): boolean
    removePlayer(player: String): void
    getPlayers(): String[]
    clearPlayers(): void
    getFriendlyFire(): boolean
    setFriendlyFire(bo: boolean): void
    setColor(color: String): void
    getColor(): String
    setSeeInvisibleTeamPlayers(bo: boolean): void
    getSeeInvisibleTeamPlayers(): boolean
}

declare class IScreenSize {
    getWidth(): Number
    getHeight(): Number
    getWidthPercent(percent: Number): Number
    getHeightPercent(percent: Number): Number
}

declare class IPlayerSkin {
    isMale(): boolean
    setMale(male: boolean): IPlayerSkin
    getBodyType(): Number
    setBodyType(type: Number): IPlayerSkin
    getBodyColor(): Number
    setBodyColor(bodyColor: Number): IPlayerSkin
    getHairType(): Number
    setHairType(type: Number): IPlayerSkin
    getHairColor(): Number
    setHairColor(hairColor: Number): IPlayerSkin
    getFaceType(): Number
    setFaceType(type: Number): IPlayerSkin
    getEyesColor(): Number
    setEyesColor(eyesColor: Number): IPlayerSkin
    getPantsType(): Number
    setPantsType(type: Number): IPlayerSkin
    getJacketType(): Number
    setJacketType(type: Number): IPlayerSkin
    getShoesType(): Number
    setShoesType(type: Number): IPlayerSkin
    getPeculiarities(): Number[]
    setPeculiarities(peculiarities: Number[]): IPlayerSkin
}
```

## World & API

```typescript
declare class IWorld {
    getNearbyEntities(x: Number, y: Number, z: Number, range: Number, type: Number): IEntity[]
    getNearbyEntities(pos: IPos, range: Number, type: Number): IEntity[]
    getClosestEntity(x: Number, y: Number, z: Number, range: Number, type: Number): IEntity
    getClosestEntity(pos: IPos, range: Number, type: Number): IEntity
    getAllEntities(type: Number): IEntity[]
    getTime(): number
    setTime(time: Number): void
    getTotalTime(): number
    getBlock(x: Number, y: Number, z: Number): IBlock
    getBlock(pos: IPos): IBlock
    setBlock(x: Number, y: Number, z: Number, name: String, meta: Number): void
    setBlock(pos: IPos, name: String): IBlock
    removeBlock(x: Number, y: Number, z: Number): void
    removeBlock(pos: IPos): void
    getLightValue(x: Number, y: Number, z: Number): Number
    getPlayer(name: String): IPlayer
    isDay(): boolean
    isRaining(): boolean
    getDimension(): IDimension
    setRaining(bo: boolean): void
    thunderStrike(x: Number, y: Number, z: Number): void
    playSoundAt(pos: IPos, sound: String, volume: Number, pitch: Number): void
    spawnParticle(particle: String, x: Number, y: Number, z: Number, dx: Number, dy: Number, dz: Number, speed: Number, count: Number): void
    broadcast(message: String): void
    getScoreboard(): IScoreboard
    getTempdata(): IData
    getStoreddata(): IData
    createItem(name: String, size: Number): IItemStack
    createItemFromNbt(nbt: INbt): IItemStack
    explode(x: Number, y: Number, z: Number, range: Number, fire: boolean, grief: boolean): void
    getAllPlayers(): IPlayer[]
    getBiomeName(x: Number, z: Number): String
    spawnEntity(entity: IEntity): void
    getRedstonePower(x: Number, y: Number, z: Number): Number
    getMCLevel(): ServerLevel
    getEntity(uuid: String): IEntity
    createEntityFromNBT(nbt: INbt): IEntity
    createEntity(id: String): IEntity
    getSpawnPoint(): IBlock
    setSpawnPoint(block: IBlock): void
    getName(): String
    trigger(id: Number, ...arguments: any[]): void
}

declare class NpcAPI {
    createNPC(world: World): ICustomNpc
    spawnNPC(world: World, x: Number, y: Number, z: Number): ICustomNpc
    getIEntity(entity: Entity): IEntity
    getIBlock(world: World, pos: BlockPos): IBlock
    getIContainer(inventory: IInventory): IContainer
    getIContainer(container: Container): IContainer
    getIItemStack(itemstack: ItemStack): IItemStack
    getIWorld(world: WorldServer): IWorld
    getIWorlds(): IWorld[]
    getINbt(compound: NBTTagCompound): INbt
    getIPos(x: Number, y: Number, z: Number): IPos
    getFactions(): IFactionHandler
    getRecipes(): IRecipeHandler
    getQuests(): IQuestHandler
    getDialogs(): IDialogHandler
    getClones(): ICloneHandler
    getIDamageSource(damagesource: DamageSource): IDamageSource
    stringToNbt(str: String): INbt
    createMail(sender: String, subject: String): IPlayerMail
    createCustomGui(id: Number, width: Number, height: Number, pauseGame: boolean, player: IPlayer): ICustomGui
    createOverlay(id: Number): IOverlay
    getRawPlayerData(uuid: String): INbt
    executeCommand(world: IWorld, command: String): String
    getRandomName(dictionary: Number, gender: Number): String
}
```

## Entity Hierarchy

```typescript
declare class IEntity {
    getX(): number
    setX(x: number): void
    getY(): number
    setY(y: number): void
    getZ(): number
    setZ(z: number): void
    getBlockX(): Number
    getBlockY(): Number
    getBlockZ(): Number
    getPos(): IPos
    setPos(pos: IPos): void
    setPosition(x: number, y: number, z: number): void
    setRotation(rotation: number): void
    getRotation(): number
    getHeight(): number
    getEyeHeight(): number
    getWidth(): number
    setPitch(pitch: number): void
    getPitch(): number
    getMount(): IEntity
    setMount(entity: IEntity): void
    getRiders(): IEntity[]
    getAllRiders(): IEntity[]
    addRider(entity: IEntity): void
    clearRiders(): void
    knockback(power: Number, direction: Number): void
    isSneaking(): boolean
    isSprinting(): boolean
    dropItem(item: IItemStack): IEntityItem
    inWater(): boolean
    inFire(): boolean
    inLava(): boolean
    getTempdata(): IData
    getStoreddata(): IData
    getNbt(): INbt
    isAlive(): boolean
    getAge(): Number
    despawn(): void
    spawn(): void
    kill(): void
    isBurning(): boolean
    setBurning(seconds: Number): void
    extinguish(): void
    getWorld(): IWorld
    getTypeName(): String
    getType(): Number
    typeOf(type: Number): boolean
    getMCEntity(): Entity
    getUUID(): String
    generateNewUUID(): String
    storeAsClone(tab: Number, name: String): void
    getEntityNbt(): INbt
    setEntityNbt(nbt: INbt): void
    rayTraceBlock(distance: Number, stopOnLiquid: boolean, ignoreBlockWithoutBoundingBox: boolean): IRayTrace
    rayTraceEntities(distance: Number, stopOnLiquid: boolean, ignoreBlockWithoutBoundingBox: boolean): IEntity
    getTags(): String[]
    addTag(tag: String): void
    hasTag(tag: String): boolean
    removeTag(tag: String): void
    playAnimation(type: Number): void
    damage(amount: number, source?: IEntity | IPlayer): void
    getMotionX(): number
    getMotionY(): number
    getMotionZ(): number
    setMotionX(motion: number): void
    setMotionY(motion: number): void
    setMotionZ(motion: number): void
    getName(): String
    setName(name: String): void
    hasCustomName(): boolean
    getEntityName(): String
}

declare class IEntityItem extends IEntity {
    getOwner(): String
    setOwner(name: String): void
    getPickupDelay(): Number
    setPickupDelay(delay: Number): void
    getAge(): Number
    setAge(age: Number): void
    getLifeSpawn(): Number
    setLifeSpawn(age: Number): void
    getItem(): IItemStack
    setItem(item: IItemStack): void
}

declare class IEntityLivingBase extends IEntity {
    playEFAnimation(directory: String): void
    getHealth(): Number
    setHealth(health: Number): void
    getMaxHealth(): Number
    setMaxHealth(health: Number): void
    isAttacking(): boolean
    setAttackTarget(living: IEntityLivingBase): void
    getAttackTarget(): IEntityLivingBase
    getLastAttacked(): IEntityLivingBase
    getLastAttackedTime(): Number
    canSeeEntity(entity: IEntity): boolean
    swingMainhand(): void
    swingOffhand(): void
    getMainhandItem(): IItemStack
    setMainhandItem(item: IItemStack): void
    getOffhandItem(): IItemStack
    setOffhandItem(item: IItemStack): void
    getArmor(slot: Number): IItemStack
    setArmor(slot: Number, item: IItemStack): void
    addPotionEffect(effect: Number, duration: Number, strength: Number, hideParticles: boolean): void
    clearPotionEffects(): void
    getPotionEffect(effect: Number): Number
    addMark(type: Number): IMark
    removeMark(mark: IMark): void
    getMarks(): IMark[]
    isChild(): boolean
    getMoveForward(): Number
    setMoveForward(move: Number): void
    getMoveStrafing(): Number
    setMoveStrafing(move: Number): void
    getMoveVertical(): Number
    setMoveVertical(move: Number): void
}

declare class IEntityLiving extends IEntityLivingBase {
    isNavigating(): boolean
    clearNavigation(): void
    navigateTo(x: Number, y: Number, z: Number, speed: Number): void
    jump(): void
    getNavigationPath(): IPos
}

declare class IMob extends IEntityLiving {
}

declare class IMonster extends IMob {
}

declare class IAnimal extends IMob {
}

declare class IVillager extends IEntityLiving {
}

declare class IArrow extends IEntity {
}
```

## Player

```typescript
declare class IPlayer extends IEntityLivingBase {
    getDisplayName(): String
    hasFinishedQuest(id: Number): boolean
    hasActiveQuest(id: Number): boolean
    startQuest(id: Number): void
    factionStatus(factionId: Number): Number
    finishQuest(id: Number): void
    stopQuest(id: Number): void
    removeQuest(id: Number): void
    hasReadDialog(id: Number): boolean
    showDialog(id: Number, name: String): void
    showSoundSelectionGUI(): void
    removeDialog(id: Number): void
    addDialog(id: Number): void
    addFactionPoints(faction: Number, points: Number): void
    getFactionPoints(faction: Number): Number
    message(message: String): void
    getGamemode(): Number
    setGamemode(mode: Number): void
    getInventory(): IContainer
    getInventoryHeldItem(): IItemStack
    removeItem(item: IItemStack, amount: Number): boolean
    removeItem(id: String, amount: Number): boolean
    removeAllItems(item: IItemStack): void
    giveItem(item: IItemStack): boolean
    giveItem(id: String, amount: Number): boolean
    setSpawnpoint(x: Number, y: Number, z: Number): void
    resetSpawnpoint(): void
    hasAdvancement(achievement: String): boolean
    getExpLevel(): Number
    setExpLevel(level: Number): void
    hasPermission(permission: String): boolean
    getTimers(): ITimers
    closeGui(): void
    getHunger(): Number
    setHunger(level: Number): void
    kick(message: String): void
    sendNotification(title: String, msg: String, type: Number): void
    sendMail(mail: IPlayerMail): void
    clearData(): void
    getActiveQuests(): IQuest[]
    getFinishedQuests(): IQuest[]
    updatePlayerInventory(): void
    playSound(sound: String, volume: Number, pitch: Number): void
    playMusic(sound: String, background: boolean, loops: boolean): void
    getOpenContainer(): IContainer
    canQuestBeAccepted(id: Number): boolean
    showCustomGui(gui: ICustomGui): void
    getCustomGui(): ICustomGui
    trigger(id: Number, ...arguments: any[]): void
    showOverlay(overlay: IOverlay): void
    hideOverlay(id: Number): void
    hideAllOverlays(): void
    getSkin(): IPlayerSkin
    getScreenSize(): IScreenSize
}
```

## NPC

```typescript
declare class ICustomNpc extends IEntityLiving {
    getDisplay(): INPCDisplay
    getInventory(): INPCInventory
    getStats(): INPCStats
    getAi(): INPCAi
    getAdvanced(): INPCAdvanced
    getFaction(): IFaction
    setFaction(id: Number): void
    getRole(): INPCRole
    getJob(): INPCJob
    getTimers(): ITimers
    getHomeX(): Number
    getHomeY(): Number
    getHomeZ(): Number
    getOwner(): IEntityLivingBase
    setHome(x: Number, y: Number, z: Number): void
    reset(): void
    say(message: String): void
    sayTo(player: IPlayer, message: String): void
    shootItem(target: IEntityLivingBase, item: IItemStack, accuracy: Number): IProjectile
    shootItem(x: Number, y: Number, z: Number, item: IItemStack, accuracy: Number): IProjectile
    giveItem(player: IPlayer, item: IItemStack): void
    setDialog(slot: Number, dialog: IDialog): void
    getDialog(slot: Number): IDialog
    updateClient(): void
    executeCommand(command: String): String
}

declare class INPCDisplay {
    getName(): String
    setName(name: String): void
    getTitle(): String
    setTitle(title: String): void
    getSkinUrl(): String
    setSkinUrl(url: String): void
    getSkinPlayer(): String
    setSkinPlayer(name: String): void
    getSkinTexture(): String
    setSkinTexture(texture: String): void
    getHasLivingAnimation(): boolean
    setHasLivingAnimation(enabled: boolean): void
    getVisible(): Number
    setVisible(type: Number): void
    isVisibleTo(player: IPlayer): boolean
    getBossbar(): Number
    setBossbar(type: Number): void
    getSize(): Number
    setSize(size: Number): void
    getTint(): Number
    setTint(color: Number): void
    getShowName(): Number
    setShowName(type: Number): void
    setCapeTexture(texture: String): void
    getCapeTexture(): String
    setOverlayTexture(texture: String): void
    getOverlayTexture(): String
    setModelScale(part: Number, x: Number, y: Number, z: Number): void
    getModelScale(part: Number): Number
    getBossColor(): Number
    setBossColor(color: Number): void
    setModel(model: String): void
    getModel(): String
    setHitboxState(state: Number): void  // 0:Normal, 1:None, 2:Solid
    getHitboxState(): Number
}

declare class INPCAi {
    getAnimation(): Number
    setAnimation(type: Number): void
    getCurrentAnimation(): Number
    setReturnsHome(bo: boolean): void
    getReturnsHome(): boolean
    getRetaliateType(): Number
    setRetaliateType(type: Number): void
    getMovingType(): Number
    setMovingType(type: Number): void
    getNavigationType(): Number
    setNavigationType(type: Number): void
    getStandingType(): Number
    setStandingType(type: Number): void
    getAttackInvisible(): boolean
    setAttackInvisible(attack: boolean): void
    getWanderingRange(): Number
    setWanderingRange(range: Number): void
    getInteractWithNPCs(): boolean
    setInteractWithNPCs(interact: boolean): void
    getStopOnInteract(): boolean
    setStopOnInteract(stopOnInteract: boolean): void
    getWalkingSpeed(): Number
    setWalkingSpeed(speed: Number): void
    getMovingPathType(): Number
    getMovingPathPauses(): boolean
    setMovingPathType(type: Number, pauses: boolean): void
    getDoorInteract(): Number
    setDoorInteract(type: Number): void
    getCanSwim(): boolean
    setCanSwim(canSwim: boolean): void
    getSheltersFrom(): Number
    setSheltersFrom(type: Number): void
    getAttackLOS(): boolean
    setAttackLOS(enabled: boolean): void
    getAvoidsWater(): boolean
    setAvoidsWater(enabled: boolean): void
    getLeapAtTarget(): boolean
    setLeapAtTarget(leap: boolean): void
    setMountControl(enabled: boolean): void
    getTacticalType(): Number
    setTacticalType(type: Number): void
    getTacticalRange(): Number
    setTacticalRange(range: Number): void
}

declare class INPCStats {
    getMaxHealth(): Number
    setMaxHealth(maxHealth: Number): void
    getResistance(type: Number): Number
    setResistance(type: Number, value: Number): void
    getCombatRegen(): Number
    setCombatRegen(regen: Number): void
    getHealthRegen(): Number
    setHealthRegen(regen: Number): void
    getMelee(): INPCMelee
    getRanged(): INPCRanged
    getImmune(type: Number): boolean
    setImmune(type: Number, bo: boolean): void
    setCreatureType(type: Number): void  // 0=Normal, 1=Undead, 2=Arthropod
    getCreatureType(): Number
    getRespawnType(): Number
    setRespawnType(type: Number): void
    getRespawnTime(): Number
    setRespawnTime(seconds: Number): void
    getHideDeadBody(): boolean
    setHideDeadBody(hide: boolean): void
    getAggroRange(): Number
    setAggroRange(range: Number): void
}

declare class INPCMelee {
    getStrength(): Number
    setStrength(strength: Number): void
    getDelay(): Number
    setDelay(speed: Number): void
    getRange(): Number
    setRange(range: Number): void
    getKnockback(): Number
    setKnockback(knockback: Number): void
    getEffectType(): Number
    getEffectTime(): Number
    getEffectStrength(): Number
    setEffect(type: Number, strength: Number, time: Number): void
}

declare class INPCRanged {
    getStrength(): Number
    setStrength(strength: Number): void
    getSpeed(): Number
    setSpeed(speed: Number): void
    getBurst(): Number
    setBurst(count: Number): void
    getBurstDelay(): Number
    setBurstDelay(delay: Number): void
    getKnockback(): Number
    setKnockback(punch: Number): void
    getSize(): Number
    setSize(size: Number): void
    getRender3D(): boolean
    setRender3D(render3d: boolean): void
    getSpins(): boolean
    setSpins(spins: boolean): void
    getSticks(): boolean
    setSticks(sticks: boolean): void
    getHasGravity(): boolean
    setHasGravity(hasGravity: boolean): void
    getAccelerate(): boolean
    setAccelerate(accelerate: boolean): void
    getExplodeSize(): Number
    setExplodeSize(size: Number): void
    getEffectType(): Number
    getEffectTime(): Number
    getEffectStrength(): Number
    setEffect(type: Number, strength: Number, time: Number): void
    getGlows(): boolean
    setGlows(glows: boolean): void
    getParticle(): Number
    setParticle(type: Number): void
    getSound(type: Number): String
    setSound(type: Number, sound: String): void
    getShotCount(): Number
    setShotCount(count: Number): void
    getHasAimAnimation(): boolean
    setHasAimAnimation(aim: boolean): void
    getAccuracy(): Number
    setAccuracy(accuracy: Number): void
    getRange(): Number
    setRange(range: Number): void
    getDelayMin(): Number
    getDelayMax(): Number
    getDelayRNG(): Number
    setDelay(min: Number, max: Number): void
    getFireType(): Number
    setFireType(type: Number): void
    getMeleeRange(): Number
    setMeleeRange(range: Number): void
}

declare class INPCInventory {
    getRightHand(): IItemStack
    setRightHand(item: IItemStack): void
    getLeftHand(): IItemStack
    setLeftHand(item: IItemStack): void
    getProjectile(): IItemStack
    setProjectile(item: IItemStack): void
    getArmor(slot: Number): IItemStack
    setArmor(slot: Number, item: IItemStack): void
    setDropItem(slot: Number, item: IItemStack, chance: Number): void
    getDropItem(slot: Number): IItemStack
    getExpMin(): Number
    getExpMax(): Number
    getExpRNG(): Number
    setExp(min: Number, max: Number): void
    getItemsRNG(): IItemStack[]
}

declare class INPCAdvanced {
    setLine(type: Number, slot: Number, text: String, sound: String): void
    getLine(type: Number, slot: Number): String
    getLineCount(type: Number): Number
    getSound(type: Number): String
    setSound(type: Number, sound: String): void
}

declare class INPCRole { getType(): Number }
declare class INPCJob { getType(): Number }
```

## Block

```typescript
declare class IBlock {
    getX(): number
    getY(): number
    getZ(): number
    getPos(): IPos
    getMetadata(): Number
    setMetadata(i: Number): void
    getName(): String
    remove(): void
    isRemoved(): boolean
    isAir(): boolean
    setBlock(name: String): IBlock
    setBlock(block: IBlock): IBlock
    hasTileEntity(): boolean
    isContainer(): boolean
    getContainer(): IContainer
    getTempdata(): IData
    getStoreddata(): IData
    getWorld(): IWorld
    getTileEntityNBT(): INbt
    setTileEntityNBT(nbt: INbt): void
    getMCTileEntity(): TileEntity
    getMCBlock(): Block
    blockEvent(type: Number, data: Number): void
    getDisplayName(): String
    getMCBlockState(): IBlockState
    interact(side: Number): void
    setModel(item: IItemStack): void
    setModel(name: String): void
    getModel(): IItemStack
    getTimers(): ITimers
    setRedstonePower(strength: Number): void
    getRedstonePower(): Number
    setIsLadder(enabled: boolean): void
    getIsLadder(): boolean
    setLight(value: Number): void
    getLight(): Number
    setScale(x: Number, y: Number, z: Number): void
    getScaleX(): Number
    getScaleY(): Number
    getScaleZ(): Number
    setRotation(x: Number, y: Number, z: Number): void
    getRotationX(): Number
    getRotationY(): Number
    getRotationZ(): Number
    executeCommand(command: String): String
    getIsPassible(): boolean
    setIsPassible(bo: boolean): void
    getHardness(): Number
    setHardness(hardness: Number): void
    getResistance(): Number
    setResistance(resistance: Number): void
    getTextPlane(): ITextPlane
    getTextPlane2(): ITextPlane
    getTextPlane3(): ITextPlane
    getTextPlane4(): ITextPlane
    getTextPlane5(): ITextPlane
    getTextPlane6(): ITextPlane
}

declare class IBlockScriptedDoor extends IBlock {
    getTimers(): ITimers
    getOpen(): boolean
    setOpen(open: boolean): void
    setBlockModel(name: String): void
    getBlockModel(): String
}

declare class ITextPlane {
    getText(): String
    setText(text: String): void
    getRotationX(): Number
    getRotationY(): Number
    getRotationZ(): Number
    setRotationX(x: Number): void
    setRotationY(y: Number): void
    setRotationZ(z: Number): void
    getOffsetX(): Number
    getOffsetY(): Number
    getOffsetZ(): Number
    setOffsetX(x: Number): void
    setOffsetY(y: Number): void
    setOffsetZ(z: Number): void
    getScale(): Number
    setScale(scale: Number): void
}
```

## Items

```typescript
declare class IItemStack {
    getStackSize(): Number
    setStackSize(size: Number): void
    getMaxStackSize(): Number
    getItemDamage(): Number
    setItemDamage(value: Number): void
    getMaxItemDamage(): Number
    getAttackDamage(): Number
    damageItem(damage: Number, living: IEntityLiving): void
    addEnchantment(id: String, strenght: Number): void
    isEnchanted(): boolean
    hasEnchant(id: String): boolean
    removeEnchant(id: String): boolean
    isBlock(): boolean
    isWearable(): boolean
    hasCustomName(): boolean
    setCustomName(name: String): void
    getDisplayName(): String
    getItemName(): String
    getName(): String
    isBook(): boolean
    copy(): IItemStack
    getMCItemStack(): ItemStack
    getNbt(): INbt
    hasNbt(): boolean
    removeNbt(): void
    getItemNbt(): INbt
    isEmpty(): boolean
    getType(): Number
    getLore(): String
    setLore(lore: String[]): void
    setAttribute(name: String, value: Number): void
    setAttribute(name: String, value: Number, slot: Number): void
    getAttribute(name: String): Number
    hasAttribute(name: String): boolean
    getTempdata(): IData
    getStoreddata(): IData
    getFoodLevel(): Number
    compare(item: IItemStack, ignoreNBT: boolean): boolean
}

declare class IItemScripted extends IItemStack {
    hasTexture(damage: Number): boolean
    getTexture(damage: Number): String
    setTexture(damage: Number, texture: String): void
    setMaxStackSize(size: Number): void
    getDurabilityValue(): Number
    setDurabilityValue(value: Number): void
    getDurabilityShow(): boolean
    setDurabilityShow(bo: boolean): void
    getDurabilityColor(): Number
    setDurabilityColor(color: Number): void
    getColor(): Number
    setColor(color: Number): void
}

declare class IItemBook extends IItemStack {
    getText(): String
    setText(pages: String[]): void
    getAuthor(): String
    setAuthor(author: String): void
    getTitle(): String
    setTitle(title: String): void
}

declare class IItemArmor extends IItemStack {
    getArmorSlot(): Number
    getArmorMaterial(): String
}
```

## Projectile

```typescript
declare class IThrowable extends IEntity {}

declare class IProjectile extends IThrowable {
    getItem(): IItemStack
    setItem(item: IItemStack): void
    getHasGravity(): boolean
    setHasGravity(bo: boolean): void
    getAccuracy(): Number
    setAccuracy(accuracy: Number): void
    setHeading(entity: IEntity): void
    setHeading(x: Number, y: Number, z: Number): void
    setHeading(yaw: Number, pitch: Number): void
    enableEvents(): void
}
```

## GUI Components

```typescript
declare class ICustomGui {
    getID(): Number
    getWidth(): Number
    getHeight(): Number
    getComponents(): java.util.List<ICustomGuiComponent>
    getSlots(): java.util.List<IItemSlot>
    setSize(width: Number, height: Number): void
    setDoesPauseGame(pauseGame: boolean): void
    setBackgroundTexture(resourceLocation: String): void
    addButton(id: Number, label: String, x: Number, y: Number): IButton
    addButton(id: Number, label: String, x: Number, y: Number, width: Number, height: Number): IButton
    addTexturedButton(id: Number, label: String, x: Number, y: Number, width: Number, height: Number, texture: String): IButton
    addTexturedButton(id: Number, label: String, x: Number, y: Number, width: Number, height: Number, texture: String, textureX: Number, textureY: Number): IButton
    addLabel(id: Number, label: String, x: Number, y: Number, width: Number, height: Number): ILabel
    addLabel(id: Number, label: String, x: Number, y: Number, width: Number, height: Number, color: Number): ILabel
    addTextField(id: Number, x: Number, y: Number, width: Number, height: Number): ITextField
    addTextArea(id: Number, x: Number, y: Number, width: Number, height: Number): ITextArea
    addTexturedRect(id: Number, texture: String, x: Number, y: Number, width: Number, height: Number): ITexturedRect
    addTexturedRect(id: Number, texture: String, x: Number, y: Number, width: Number, height: Number, textureX: Number, textureY: Number): ITexturedRect
    addScroll(id: Number, x: Number, y: Number, width: Number, height: Number, list: String[]): IScroll
    addItemSlot(x: Number, y: Number): IItemSlot
    addItemSlot(x: Number, y: Number, stack: IItemStack): IItemSlot
    showPlayerInventory(x: Number, y: Number): void
    getComponent(id: Number): ICustomGuiComponent
    removeComponent(id: Number): void
    updateComponent(component: ICustomGuiComponent): void
    update(player: IPlayer): void
    addEntityDisplay(id: number, x: number, y: number, entity: IEntity): IEntityDisplay
    addSlider(id: number, x: number, y: number, width: number, height: number, min: number, max: number, value: number, step?: number): ISlider
    addItemRenderer(id: number, x: number, y: number, stack: IItemStack): IItemRenderer
    addItemRenderer(id: number, x: number, y: number, width: number, height: number, stack: IItemStack): IItemRenderer
    addComponentsWrapper(id: number, x: number, y: number, width: number, height: number): IComponentsWrapper
    addComponentsScrollableWrapper(id: number, x: number, y: number, width: number, height: number): IComponentsScrollableWrapper
    addButtonList(id: number, x: number, y: number, width: number, height: number, list: string[]): IButtonList
    addAssetsSelector(id: number, x: number, y: number, width: number, height: number, filter?: string): IAssetsSelector
}

declare class ICustomGuiComponent {
    getID(): Number
    setID(id: Number): ICustomGuiComponent
    getPosX(): Number
    getPosY(): Number
    setPos(x: Number, y: Number): ICustomGuiComponent
    hasHoverText(): boolean
    getHoverText(): String
    setHoverText(text: String): ICustomGuiComponent
    setHoverText(text: String[]): ICustomGuiComponent
}

declare class IButton extends ICustomGuiComponent {
    getWidth(): Number
    getHeight(): Number
    setSize(width: Number, height: Number): IButton
    getLabel(): String
    setLabel(label: String): IButton
    getTexture(): String
    hasTexture(): boolean
    setTexture(texture: String): IButton
    getTextureX(): Number
    getTextureY(): Number
    setTextureOffset(textureX: Number, textureY: Number): IButton
    setEnabled(bo: boolean): void
    getEnabled(): boolean
}

declare class ILabel extends ICustomGuiComponent {
    getText(): String
    setText(label: String): ILabel
    getWidth(): Number
    getHeight(): Number
    setSize(width: Number, height: Number): ILabel
    getColor(): Number
    setColor(color: Number): ILabel
    getScale(): Number
    setScale(scale: Number): ILabel
}

declare class IScroll extends ICustomGuiComponent {
    getWidth(): Number
    getHeight(): Number
    setSize(width: Number, height: Number): IScroll
    getList(): String
    setList(list: String[]): IScroll
    getDefaultSelection(): Number
    setDefaultSelection(defaultSelection: Number): IScroll
    isMultiSelect(): boolean
    setMultiSelect(multiSelect: boolean): IScroll
}

declare class ITextField extends ICustomGuiComponent {
    getWidth(): Number
    getHeight(): Number
    setSize(width: Number, height: Number): ITextField
    getText(): String
    setText(defaultText: String): ITextField
    setEnabled(bo: boolean): void
    getEnabled(): boolean
}

declare class ITextArea extends ITextField {
    setCodeTheme(bo: boolean): void
    getCodeTheme(): boolean
}

declare class ITexturedRect extends ICustomGuiComponent {
    getTexture(): String
    setTexture(texture: String): ITexturedRect
    getWidth(): Number
    getHeight(): Number
    setSize(width: Number, height: Number): ITexturedRect
    getScale(): Number
    setScale(scale: Number): ITexturedRect
    getTextureX(): Number
    getTextureY(): Number
    setTextureOffset(offsetX: Number, offsetY: Number): ITexturedRect
}

declare class IItemSlot extends ICustomGuiComponent {
    hasStack(): boolean
    getStack(): IItemStack
    setStack(itemStack: IItemStack): IItemSlot
    getMCSlot(): Slot
}

declare interface ISlider extends ICustomGuiComponent {
    getValue(): number
    setValue(value: number): ISlider
    getMin(): number
    getMax(): number
    setMinMax(min: number, max: number): ISlider
    getStep(): number
    setStep(step: number): ISlider
    getWidth(): number
    getHeight(): number
    setSize(width: number, height: number): ISlider
}

declare interface IItemRenderer extends ICustomGuiComponent {
    getStack(): IItemStack
    setStack(stack: IItemStack): IItemRenderer
    getScale(): number
    setScale(scale: number): IItemRenderer
}

declare interface IEntityDisplay extends ICustomGuiComponent {
    getEntity(): IEntity
    setEntity(entity: IEntity): IEntityDisplay
    getScale(): number
    setScale(scale: number): IEntityDisplay
    setRotation(yaw: number, pitch: number): IEntityDisplay
}

declare interface IComponentsWrapper extends ICustomGuiComponent {
    getComponents(): ICustomGuiComponent[]
    add(component: ICustomGuiComponent): IComponentsWrapper
    clear(): void
}

declare interface IComponentsScrollableWrapper extends IComponentsWrapper {
    setScrollSize(width: number, height: number): IComponentsScrollableWrapper
    getScrollWidth(): number
    getScrollHeight(): number
}

declare interface IButtonList extends ICustomGuiComponent {
    getList(): string[]
    setList(list: string[]): IButtonList
    getSelected(): number
    setSelected(index: number): IButtonList
}

declare interface IAssetsSelector extends ICustomGuiComponent {
    setFilter(filter: string): IAssetsSelector
    getFilter(): string
    getSelected(): string
}
```

## Overlays

```typescript
declare class IOverlay {
    addLabel(id: number, text: string, x: number, y: number): ILabel
    addRenderItem(id: number, x: number, y: number, item: IItemStack): IRenderItemOverlay
    addTexturedRect(id: number, texture: string, x: number, y: number, width: number, height: number): ITexturedRect
    addTexturedRectCrop(id: number, texture: string, x: number, y: number, w: number, h: number, texX: number, texY: number): ITexturedRect
    addTexturedRectCrop(id: number, texture: string, x: number, y: number, w: number, h: number, texX: number, texY: number, texMaxX: number, texMaxY: number): ITexturedRect
    clear(): void
    getComponent(id: number): IOverlayComponent
    getComponents(): IOverlayComponent[]
    getId(): number
    getLinkSide(): number
    removeComponent(id: number): void
    setLinkSide(side: number): void
}
```

## Event Classes

```typescript
declare class MinecraftForgeEvent {
    setCanceled(canceled: Boolean): void
    isCancelable(): Boolean
    isCanceled(): Boolean
}

declare class CustomNPCsEvent extends MinecraftForgeEvent {
    API: NpcAPI
}

declare class BlockEvent extends CustomNPCsEvent { block: IBlock }
declare class PlayerEvent extends CustomNPCsEvent { player: IPlayer }
declare class NpcEvent extends CustomNPCsEvent { npc: ICustomNpc }
declare class ItemEvent extends CustomNPCsEvent { item: IItemScripted }
declare class DialogEvent extends CustomNPCsEvent { dialog: IDialog; player: IPlayer }
declare class CustomGuiEvent extends CustomNPCsEvent { player: IPlayer; gui: ICustomGui }
declare class QuestEvent extends CustomNPCsEvent { quest: IQuest; player: IPlayer }
declare class RoleEvent extends CustomNPCsEvent { npc: ICustomNpc; player: IPlayer }
declare class ProjectileEvent extends CustomNPCsEvent { projectile: IProjectile }
declare class WorldEvent extends CustomNPCsEvent { world: IWorld }

// BlockEvent sub-events
declare namespace BlockEvent {
    class InitEvent extends BlockEvent {}
    class TimerEvent extends BlockEvent { id: Number }
    class UpdateEvent extends BlockEvent {}
    class InteractEvent extends BlockEvent { player: IPlayer; hitX: Number; hitY: Number; hitZ: Number; side: Number }
    class ClickedEvent extends BlockEvent { player: IPlayer }
    class RedstoneEvent extends BlockEvent { prevPower: Number; power: Number }
    class CollidedEvent extends BlockEvent { entity: IEntity }
    class NeighborChangedEvent extends BlockEvent { changedPos: IPos }
    class BreakEvent extends BlockEvent {}
    class HarvestedEvent extends BlockEvent { player: IPlayer }
    class ExplodedEvent extends BlockEvent {}
    class DoorToggleEvent extends BlockEvent {}
    class EntityFallenUponEvent extends BlockEvent { entity: IEntity; distanceFallen }
    class RainFillEvent extends BlockEvent {}
}

// PlayerEvent sub-events
declare namespace PlayerEvent {
    class InitEvent extends PlayerEvent {}
    class UpdateEvent extends PlayerEvent {}
    class LoginEvent extends PlayerEvent {}
    class LogoutEvent extends PlayerEvent {}
    class ChatEvent extends PlayerEvent { message: String }
    class AttackEvent extends PlayerEvent { type: Number; target: IEntity; damageSource }
    class InteractEvent extends PlayerEvent { type: Number; target: IEntity }
    class BreakEvent extends PlayerEvent { block: IBlock; exp: Number }
    class DamagedEvent extends PlayerEvent { damageSource; source: IEntity; damage: Number; clearTarget }
    class DamagedEntityEvent extends PlayerEvent { damage: Number; target: IEntity; damageSource }
    class DiedEvent extends PlayerEvent { damageSource; type; source }
    class KilledEntityEvent extends PlayerEvent { entity: IEntityLivingBase }
    class PickUpEvent extends PlayerEvent { item: IItemStack }
    class TossEvent extends PlayerEvent { item: IItemStack }
    class ContainerOpen extends PlayerEvent { container: IContainer }
    class ContainerClosed extends PlayerEvent { container: IContainer }
    class TimerEvent extends PlayerEvent { id: Number }
    class KeyPressedEvent extends PlayerEvent { key: number; isCtrlPressed: boolean; isAltPressed: boolean; isShiftPressed: boolean; isMetaPressed: boolean }
    class LevelUpEvent extends PlayerEvent { change: Number }
    class FactionUpdateEvent extends PlayerEvent { faction: IFaction; points: Number; init: boolean }
    class RangedLaunchedEvent extends PlayerEvent {}
}

// NpcEvent sub-events
declare namespace NpcEvent {
    class InitEvent extends NpcEvent {}
    class UpdateEvent extends NpcEvent {}
    class InteractEvent extends NpcEvent { player: IPlayer }
    class DamagedEvent extends NpcEvent { damageSource; source: IEntity; damage: Number; clearTarget }
    class DiedEvent extends NpcEvent { damageSource; type; source; droppedItems; expDropped; line }
    class KilledEntityEvent extends NpcEvent { entity: IEntityLivingBase }
    class TargetEvent extends NpcEvent { entity: IEntityLivingBase }
    class TargetLostEvent extends NpcEvent { entity: IEntityLivingBase }
    class MeleeAttackEvent extends NpcEvent { target: IEntityLivingBase; damage: Number }
    class RangedLaunchedEvent extends NpcEvent { target: IEntityLivingBase; damage: Number; projectiles: java.util.List<IProjectile> }
    class TimerEvent extends NpcEvent { id: Number }
    class CollideEvent extends NpcEvent { entity: IEntity }
}

// CustomGuiEvent sub-events
declare namespace CustomGuiEvent {
    class ButtonEvent extends CustomGuiEvent { buttonId: Number }
    class ScrollEvent extends CustomGuiEvent { scrollId: Number; selection: String[]; doubleClick: boolean; scrollIndex: Number }
    class SlotEvent extends CustomGuiEvent { slotId: Number; stack: IItemStack }
    class SlotClickEvent extends CustomGuiEvent { slotId: Number; stack: IItemStack; dragType: Number; clickType: String }
    class CloseEvent extends CustomGuiEvent {}
}

// ItemEvent sub-events
declare namespace ItemEvent {
    class InitEvent extends ItemEvent {}
    class InteractEvent extends ItemEvent { type: Number; target: IEntity; player: IPlayer }
    class AttackEvent extends ItemEvent { type: Number; target: IEntity; player: IPlayer; damageSource }
    class TossedEvent extends ItemEvent { entity: IEntityItem; player: IPlayer }
    class PickedUpEvent extends ItemEvent { entity: IEntityItem; player: IPlayer }
    class SpawnEvent extends ItemEvent { entity: IEntityItem }
    class UpdateEvent extends ItemEvent { player: IPlayer }
}

// DialogEvent, QuestEvent, RoleEvent, ProjectileEvent, WorldEvent sub-events
declare namespace DialogEvent {
    class OpenEvent extends DialogEvent {}
    class CloseEvent extends DialogEvent {}
    class OptionEvent extends DialogEvent { option: IDialogOption }
}
declare namespace QuestEvent {
    class QuestStartEvent extends QuestEvent {}
    class QuestCompletedEvent extends QuestEvent {}
    class QuestTurnedInEvent extends QuestEvent { expReward: Number; itemRewards: IItemStack[] }
}
declare namespace RoleEvent {
    class TraderEvent extends RoleEvent { sold: IItemStack; currency1: IItemStack; currency2: IItemStack }
    class TradeFailedEvent extends RoleEvent { sold: IItemStack; currency1: IItemStack; currency2: IItemStack; receiving }
    class FollowerHireEvent extends RoleEvent { days: Number }
    class FollowerFinishedEvent extends RoleEvent {}
    class TransporterUseEvent extends RoleEvent { location: IRoleTransporter.ITransportLocation }
    class TransporterUnlockedEvent extends RoleEvent {}
    class BankUpgradedEvent extends RoleEvent { slot: Number }
    class BankUnlockedEvent extends RoleEvent { slot: Number }
    class MailmanEvent extends RoleEvent { mail: IPlayerMail }
}
declare namespace ProjectileEvent {
    class ImpactEvent extends ProjectileEvent { type: Number; target: Object }
    class UpdateEvent extends ProjectileEvent {}
}
declare namespace WorldEvent {
    class ScriptCommandEvent extends WorldEvent { arguments: String[]; pos: IPos }
}
```

## Handlers & Misc

```typescript
declare class ICloneHandler {
    spawn(x: Number, y: Number, z: Number, tab: Number, name: String, world: IWorld): IEntity
    get(tab: Number, name: String, world: IWorld): IEntity
    set(tab: Number, name: String, entity: IEntity): void
    remove(tab: Number, name: String): void
}
declare class IDialogHandler { categories(): java.util.List<IDialogCategory>; get(id: Number): IDialog }
declare class IFactionHandler { list(): java.util.List<IFaction>; delete(id: Number): IFaction; create(name: String, color: Number): IFaction; get(id: Number): IFaction }
declare class IQuestHandler { categories(): java.util.List<IQuestCategory>; get(id: Number): IQuest }
declare class IRecipeHandler { getGlobalList(): java.util.List<IRecipe>; getCarpentryList(): java.util.List<IRecipe>; addRecipe(name: String, global: boolean, result: IItemStack, objects: Object[]): IRecipe; delete(id: Number): IRecipe }

declare class IDialog { getId(): Number; getName(): String; setName(name: String): void; getText(): String; setText(text: String): void; getQuest(): IQuest; setQuest(quest: IQuest): void; getCommand(): String; setCommand(command: String): void; getOptions(): java.util.List<IDialogOption>; getOption(slot: Number): IDialogOption; getAvailability(): IAvailability; getCategory(): IDialogCategory; save(): void }
declare class IDialogCategory { dialogs(): java.util.List<IDialog>; getName(): String; create(): IDialog }
declare class IDialogOption { getSlot(): Number; getName(): String; getType(): Number; isValid(): boolean; getDialog(): IDialog; hasDialog(): boolean; canClose(): boolean }

declare class IFaction { getId(): Number; getName(): String; getDefaultPoints(): Number; setDefaultPoints(points: Number): void; getColor(): Number; playerStatus(player: IPlayer): Number; hostileToNpc(npc: ICustomNpc): boolean; hostileToFaction(factionId: Number): boolean; addHostile(id: Number): void; removeHostile(id: Number): void; hasHostile(id: Number): boolean; getIsHidden(): boolean; setIsHidden(bo: boolean): void; save(): void }

declare class IQuest { getId(): Number; getName(): String; setName(name: String): void; getType(): Number; setType(type: Number): void; getLogText(): String; setLogText(text: String): void; getCompleteText(): String; setCompleteText(text: String): void; getNextQuest(): IQuest; setNextQuest(quest: IQuest): void; getObjectives(player: IPlayer): IQuestObjective; getCategory(): IQuestCategory; getRewards(): IContainer; save(): void; getIsRepeatable(): boolean }

declare class IAvailability { isAvailable(player: IPlayer): boolean; getDaytime(): Number; setDaytime(type: Number): void; getMinPlayerLevel(): Number; setMinPlayerLevel(level: Number): void; setDialog(i: Number, id: Number, type: Number): void; removeDialog(i: Number): void; setQuest(i: Number, id: Number, type: Number): void; removeQuest(i: Number): void; setFaction(i: Number, id: Number, type: Number, stance: Number): void; setScoreboard(i: Number, objective: String, type: Number, value: Number): void }

declare class IPlayerMail { getSender(): String; setSender(sender: String): void; getSubject(): String; setSubject(subject: String): void; getText(): String; setText(text: String[]): void; getQuest(): IQuest; setQuest(id: Number): void; getContainer(): IContainer }

// Roles
declare class IRoleTrader extends INPCRole { getSold(slot: Number): IItemStack; getCurrency1(slot: Number): IItemStack; getCurrency2(slot: Number): IItemStack; set(slot: Number, currency: IItemStack, currency2: IItemStack, sold: IItemStack): void; remove(slot: Number): void; setMarket(name: String): void; getMarket(): String }
declare class IRoleFollower extends INPCRole { getDays(): Number; addDays(days: Number): void; getInfinite(): boolean; setInfinite(infinite: boolean): void; getGuiDisabled(): boolean; setGuiDisabled(disabled: boolean): void; getFollowing(): IPlayer; setFollowing(player: IPlayer): void; isFollowing(): boolean; reset(): void }

// Jobs
declare class IJobPuppet extends INPCJob { getIsAnimated(): boolean; setIsAnimated(bo: boolean): void; getAnimationSpeed(): Number; setAnimationSpeed(speed: Number): void; getPart(part: Number): IJobPuppetPart }
declare class IJobSpawner { spawnEntity(i: Number): IEntityLivingBase; removeAllSpawned(): void }
declare class IJobFollower extends INPCJob { getFollowing(): String; setFollowing(name: String): void; isFollowing(): boolean; getFollowingNpc(): ICustomNpc }
```

## Constants

```typescript
// Entity Types
const EntityType_ANY = -1, EntityType_UNKNOWN = 0, EntityType_PLAYER = 1, EntityType_NPC = 2
const EntityType_MONSTER = 3, EntityType_ANIMAL = 4, EntityType_LIVING = 5, EntityType_ITEM = 6
const EntityType_PROJECTILE = 7, EntityType_PIXELMON = 8, EntityType_VILLAGER = 9
const EntityType_ARROW = 10, EntityType_THROWABLE = 11

// Animation Types
const AnimationType_NORMAL = 0, AnimationType_SIT = 1, AnimationType_SLEEP = 2
const AnimationType_HUG = 3, AnimationType_SNEAK = 4, AnimationType_DANCE = 5
const AnimationType_AIM = 6, AnimationType_CRAWL = 7, AnimationType_POINT = 8
const AnimationType_CRY = 9, AnimationType_WAVE = 10, AnimationType_BOW = 11
const AnimationType_NO = 12, AnimationType_YES = 13, AnimationType_DEATH = 14

// GUI Component Types
const GuiComponentType_BUTTON = 0, GuiComponentType_LABEL = 1, GuiComponentType_TEXTURED_RECT = 2
const GuiComponentType_TEXT_FIELD = 3, GuiComponentType_SCROLL = 4, GuiComponentType_ITEM_SLOT = 5
const GuiComponentType_TEXT_AREA = 6

// Item/Job/Role/Mark/Quest/Potion/Particle types
const JobType_NONE = 0, JobType_BARD = 1, JobType_HEALER = 2, JobType_GUARD = 3
const JobType_ITEMGIVER = 4, JobType_FOLLOWER = 5, JobType_SPAWNER = 6
const JobType_CONVERSATION = 7, JobType_CHUNKLOADER = 8, JobType_PUPPET = 9
const JobType_BUILDER = 10, JobType_FARMER = 11

const RoleType_NONE = 0, RoleType_TRADER = 1, RoleType_FOLLOWER = 2, RoleType_BANK = 3
const RoleType_TRANSPORTER = 4, RoleType_MAILMAN = 5, RoleType_COMPANION = 6, RoleType_DIALOG = 7

const MarkType_NONE = 0, MarkType_QUESTION = 1, MarkType_EXCLAMATION = 2
const MarkType_POINTER = 3, MarkType_SKULL = 4, MarkType_CROSS = 5, MarkType_STAR = 6

const QuestType_ITEM = 0, QuestType_DIALOG = 1, QuestType_KILL = 2
const QuestType_LOCATION = 3, QuestType_AREA_KILL = 4, QuestType_MANUAL = 5

// Script console helpers
declare function print(...args: any[]): void
declare function log(...args: any[]): void

// java.util.List
declare namespace java.util {
    class List<T> { size(): Number; get(index: Number): T; isEmpty(): boolean; toArray(): T[] }
}
```
