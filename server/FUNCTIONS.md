# Utils

- `hashHex = sha256(input, [iterations])` - Returns deterministic SHA-256 as a lowercase 64-character hex string. `iterations` is optional and defaults to `1`; when `iterations > 1`, each additional round hashes the previous 64-char hex output. Supports account hashing flows like `sha256(saltHex + password + pepper, iterations)`.
- `result = collapseColors(string)`
- `result = stripColors(string)`

# Animations

- `name = player getLegsAnimation()` - Returns the name of the player animation the legs play, such as `pb_stand_alert`; returns `""` for an index outside the animation list, and `undefined` if the entity is not a player.
- `name = player getTorsoAnimation()` - Returns the name of the player animation the torso plays, as `getLegsAnimation`.

# Weapons

- `slotId = player getCurrentSlotId()` - Returns current slot ID (0=none, 1=primary, 2=primaryb); returns `undefined` if the entity is not a player.
- `weaponId = player getCurrentWeaponId()` - Returns current weapon ID; returns `undefined` if the entity is not a player.
- `weaponId = player getWeaponIdInSlotId(slotId)` - Returns weapon ID in slot (may be `0` if empty); returns `undefined` if the entity is not a player, the arg is wrong type, or the slot ID is invalid.
- `clip = player getSlotIdClipAmmo(slotId)` - Returns clip ammo for the weapon in the slot; returns `0` if slot is invalid, empty, or has no clip; returns `undefined` if the entity is not a player or the arg is wrong type.
- `ammo = player getSlotIdAmmo(slotId)` - Returns ammo for the weapon in the slot (clip-only weapons return clip ammo); returns `0` if slot is invalid, empty, or has no ammo type; returns `undefined` if the entity is not a player or the arg is wrong type.
- `clip = player getWeaponIdClipAmmo(weaponId)` - Returns clip ammo for weapon ID; returns `0` if the weapon has no clip; returns `undefined` if the entity is not a player, the arg is wrong type, or the weapon ID is invalid.
- `ammo = player getWeaponIdAmmo(weaponId)` - Returns ammo for weapon ID (clip-only weapons return clip ammo); returns `0` if the weapon has no ammo type; returns `undefined` if the entity is not a player, the arg is wrong type, or the weapon ID is invalid.
- `isSuccess = player setWeaponIdInSlotId(slotId, weaponId)` - Returns `true` on success, `false` if slot is invalid, player is not active, or weapon ID is invalid (non-zero); returns `undefined` if the entity is not a player or args are wrong type.
- `isSuccess = player setSlotIdClipAmmo(slotId, clipAmmo)` - Returns `true` on success (clamps to valid range), `false` if slot is invalid, player is not active, slot is empty, or weapon has no clip; returns `undefined` if the entity is not a player or args are wrong type.
- `isSuccess = player setSlotIdAmmo(slotId, ammo)` - Returns `true` on success (clamps to valid range), `false` if slot is invalid, player is not active, slot is empty, or weapon has no ammo type; returns `undefined` if the entity is not a player or args are wrong type.
- `isSuccess = player setWeaponIdClipAmmo(weaponId, clipAmmo)` - Returns `true` on success (clamps to valid range), `false` if weapon ID is invalid, player is not active, or weapon has no clip; returns `undefined` if the entity is not a player or args are wrong type.
- `isSuccess = player setWeaponIdAmmo(weaponId, ammo)` - Returns `true` on success (clamps to valid range), `false` if weapon ID is invalid, player is not active, or weapon has no ammo type; returns `undefined` if the entity is not a player or args are wrong type.
- `weaponId = weaponNameToId(weaponName)` - Returns weapon ID (often `0` if not found); returns `undefined` if the arg is wrong type or missing.
- `clipSize = getWeaponIdClipAmmoSize(weaponId)` - Returns clip size for weapon ID; returns `0` if the weapon has no clip; returns `undefined` if the arg is wrong type or the weapon ID is invalid.
- `ammoSize = getWeaponIdAmmoSize(weaponId)` - Returns max ammo for weapon ID (clip-only weapons return clip size); returns `0` if the weapon has no ammo type; returns `undefined` if the arg is wrong type or the weapon ID is invalid.
- `startAmmo = getWeaponIdAmmoStartSize(weaponId)` - Returns starting ammo for weapon ID; returns `undefined` if the arg is wrong type or the weapon ID is invalid.

# Graph

- `graphId = graphCreate([persist], [nodeCapacity])` - Returns new graph ID; `nodeCapacity` is NOT a hard limit.
- `isSuccess = graphRemove(graphId)` - Returns `true` on success; returns `undefined` if graph does not exist.
- `isSuccess = graphRemoveAll()` - Returns `true`.
- `nodeId = graphAddNode(graphId, origin, [type], [nodeId])` - Returns node ID; returns `undefined` if graph does not exist, node ID already exists, or (FSA) graph hit max nodes.
- `properties = graphGetNodeProperties(graphId, nodeId)` - Returns array with `origin` and `type`; returns `undefined` if graph or node does not exist.
- `origin = graphGetNodeOrigin(graphId, nodeId)` - Returns node origin; returns `undefined` if graph or node does not exist.
- `isSuccess = graphSetNodeOrigin(graphId, nodeId, origin)` - Returns `true` and resets the cost of every edge to and from the node to the edge's 3D length, overwriting custom costs; returns `undefined` if graph or node does not exist.
- `isSuccess = graphSetNodeType(graphId, nodeId, type)` - Returns `true`; returns `undefined` if graph or node does not exist.
- `nodeIds = graphGetNodeIdsAccessibleFrom(graphId, nodeId)` - Returns array of node IDs that the node has an edge to; returns `undefined` if graph or node does not exist.
- `nodeIds = graphGetNodeIdsAccessibleTo(graphId, nodeId)` - Returns array of node IDs that have an edge to the node; returns `undefined` if graph or node does not exist.
- `nodeIds = graphGetAllNodes(graphId, [origin], [maxDistSq])` - Returns array of node IDs; if `origin` is given, only nodes whose squared distance to it is at most `maxDistSq` (no limit if `maxDistSq` is omitted); returns `undefined` if graph does not exist.
- `isSuccess = graphRemoveNode(graphId, nodeId)` - Returns `true` if removed, `false` if node not found; returns `undefined` if graph does not exist.
- `isSuccess = graphAddEdge(graphId, fromNodeId, toNodeId, [type], [cost])` - Returns `true` on success; returns `undefined` if graph does not exist, start/end missing, edge already exists, start=end, or (FSA) start node hit max edges.
- `properties = graphGetEdgeProperties(graphId, fromNodeId, toNodeId)` - Returns array with `start`, `end`, `type`, `cost`; returns `undefined` if graph/start/end/edge not found.
- `edges = graphGetAllEdges(graphId)` - Returns array of edges, each an array with `start`, `end`, `type`, `cost`; returns `undefined` if graph does not exist.
- `isSuccess = graphSetEdgeType(graphId, fromNodeId, toNodeId, type)` - Returns `true` if updated, `false` if edge not found; returns `undefined` if graph/start/end not found.
- `type = graphGetEdgeType(graphId, fromNodeId, toNodeId)` - Returns edge type; returns `undefined` if graph/start/end/edge not found.
- `isSuccess = graphRemoveEdge(graphId, fromNodeId, toNodeId)` - Returns `true` if removed, `false` if edge not found; returns `undefined` if graph/start/end not found or (FSA) start has no edges.
- `nodeCount = graphAutodiscover(graphId, origin, mins, maxs, sampleSpacing, edgeLinkRadius, minWallClearance, maxStepHeight, normalHeight, crouchHeight, proneHeight, edgeTypeNormal, edgeTypeCrouch, edgeTypeProne, [edgeTypeLadder], [edgeTypeMantle], [edgeTypeJump], [maxJumpHeight])` - Returns number of nodes after discovery; returns `undefined` if graph missing, parameters invalid, or no nodes found.
- `path = graphFindPath(graphId, startNodeId, endNodeId, [skipNodeIds], [skipNodeTypes], [skipEdgeTypes])` - Returns array of node IDs (includes `start`) if path found; returns `undefined` if graph is missing, nodes invalid, skip list invalid, or no path found.
- `isSuccess = graphPrecomputePathsToNode(graphId, nodeId, [skipNodeTypes], [skipEdgeTypes])` - Returns `true` on success; returns `undefined` if graph missing, no nodes, goal missing, or precompute failed.
- `nodeId = graphFindClosestNode(graphId, origin, [contentMask])` - Returns closest node ID; if `contentMask` is provided, only nodes with an unobstructed trace to `origin` using that mask are considered; returns `undefined` if graph missing, has no nodes, or no node passes the mask trace.
- `edgeInfo = graphFindClosestEdge(graphId, origin)` - Returns array with `start`, `end`, `origin` (closest point), `cost`, `type`; returns `undefined` if graph missing, has <2 nodes, or has no edges.

# Level

- `players = getPlayersInRange(origin, [maxDistSq], [filterTeam], [traceContentMask])` - Returns array of players whose player origins are within `maxDistSq` of `origin` when provided; if `maxDistSq` is omitted/undefined, no distance limit is applied. Optional `filterTeam` is an int team ID (0=free, 1=axis, 2=allies, 3=spectator, no filter when omitted/undefined), optional `traceContentMask` is an int content mask for line-of-sight trace to player origin.
- `players = getPlayersByViewOriginInRange(origin, [maxDistSq], [filterTeam], [traceContentMask])` - Returns array of players whose view origins are within `maxDistSq` of `origin` when provided; if `maxDistSq` is omitted/undefined, no distance limit is applied. Optional `filterTeam` is an int team ID (0=free, 1=axis, 2=allies, 3=spectator, no filter when omitted/undefined), optional `traceContentMask` is an int content mask for line-of-sight trace to view origin.
- `player = getClosestPlayerInRange(origin, [maxDistSq], [filterTeam], [traceContentMask])` - Returns closest player by player origin within `maxDistSq` of `origin` when provided; if `maxDistSq` is omitted/undefined, no distance limit is applied. Optional `filterTeam` is an int team ID (0=free, 1=axis, 2=allies, 3=spectator, no filter when omitted/undefined), optional `traceContentMask` is an int content mask for line-of-sight trace to player origin; returns `undefined` if none found.
- `player = getClosestPlayerByViewOriginInRange(origin, [maxDistSq], [filterTeam], [traceContentMask])` - Returns closest player by view origin within `maxDistSq` of `origin` when provided; if `maxDistSq` is omitted/undefined, no distance limit is applied. Optional `filterTeam` is an int team ID (0=free, 1=axis, 2=allies, 3=spectator, no filter when omitted/undefined), optional `traceContentMask` is an int content mask for line-of-sight trace to view origin; returns `undefined` if none found.
