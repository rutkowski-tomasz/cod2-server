#include "nl.hpp"

// Phase 1: Simple Getters

void gsc_player_getcurrentslotid(scr_entref_t ref)
{
	int id = ref.entnum;

	if ( id >= MAX_CLIENTS )
	{
		stackError("gsc_player_getcurrentslotid() entity %i is not a player", id);
		stackPushUndefined();
		return;
	}

	weapSlot_t slot = GetCurrentWeaponSlot(id);
	stackPushInt((int)slot);
}

void gsc_player_getcurrentweaponid(scr_entref_t ref)
{
	int id = ref.entnum;

	if ( id >= MAX_CLIENTS )
	{
		stackError("gsc_player_getcurrentweaponid() entity %i is not a player", id);
		stackPushUndefined();
		return;
	}

	playerState_t *ps = SV_GameClientNum(id);
	stackPushInt(ps->weapon);
}

void gsc_player_getweaponidinslotid(scr_entref_t ref)
{
	int id = ref.entnum;

	if ( id >= MAX_CLIENTS )
	{
		stackError("gsc_player_getweaponidinslotid() entity %i is not a player", id);
		stackPushUndefined();
		return;
	}

	int slotId;
	if ( !stackGetParams("i", &slotId) )
	{
		stackError("gsc_player_getweaponidinslotid() argument is undefined or has a wrong type");
		stackPushUndefined();
		return;
	}

	if ( slotId < WEAPSLOT_NONE || slotId >= WEAPSLOT_NUM )
	{
		stackError("gsc_player_getweaponidinslotid() invalid slot ID %i (must be 0, 1, or 2)", slotId);
		stackPushUndefined();
		return;
	}

	playerState_t *ps = SV_GameClientNum(id);
	stackPushInt(ps->weaponslots[slotId]);
}

// Phase 2: Weapon-based Ammo Functions

void gsc_player_getweaponidclipammo(scr_entref_t ref)
{
	int id = ref.entnum;

	if ( id >= MAX_CLIENTS )
	{
		stackError("gsc_player_getweaponidclipammo() entity %i is not a player", id);
		stackPushUndefined();
		return;
	}

	int weaponId;
	if ( !stackGetParams("i", &weaponId) )
	{
		stackError("gsc_player_getweaponidclipammo() argument is undefined or has a wrong type");
		stackPushUndefined();
		return;
	}

	if ( !IsValidWeaponId(weaponId) )
	{
		stackError("gsc_player_getweaponidclipammo() invalid weapon ID %i", weaponId);
		stackPushUndefined();
		return;
	}

	playerState_t *ps = SV_GameClientNum(id);
	int clipIndex = BG_ClipForWeapon(weaponId);

	if ( clipIndex == 0 )
	{
		stackPushInt(0);
		return;
	}

	stackPushInt(ps->ammoclip[clipIndex]);
}

void gsc_player_getweaponidammo(scr_entref_t ref)
{
	int id = ref.entnum;

	if ( id >= MAX_CLIENTS )
	{
		stackError("gsc_player_getweaponidammo() entity %i is not a player", id);
		stackPushUndefined();
		return;
	}

	int weaponId;
	if ( !stackGetParams("i", &weaponId) )
	{
		stackError("gsc_player_getweaponidammo() argument is undefined or has a wrong type");
		stackPushUndefined();
		return;
	}

	if ( !IsValidWeaponId(weaponId) )
	{
		stackError("gsc_player_getweaponidammo() invalid weapon ID %i", weaponId);
		stackPushUndefined();
		return;
	}

	playerState_t *ps = SV_GameClientNum(id);

	// Clip-only weapons store ammo in ammoclip
	if ( BG_WeaponIsClipOnly(weaponId) )
	{
		int clipIndex = BG_ClipForWeapon(weaponId);
		stackPushInt(ps->ammoclip[clipIndex]);
	}
	else
	{
		int ammoIndex = BG_AmmoForWeapon(weaponId);
		if ( ammoIndex == 0 )
		{
			stackPushInt(0);
			return;
		}
		stackPushInt(ps->ammo[ammoIndex]);
	}
}

void gsc_player_setweaponidclipammo(scr_entref_t ref)
{
	int id = ref.entnum;

	if ( id >= MAX_CLIENTS )
	{
		stackError("gsc_player_setweaponidclipammo() entity %i is not a player", id);
		stackPushUndefined();
		return;
	}

	int weaponId, clipAmmo;
	if ( !stackGetParams("ii", &weaponId, &clipAmmo) )
	{
		stackError("gsc_player_setweaponidclipammo() one or more arguments are undefined or have wrong types");
		stackPushUndefined();
		return;
	}

	if ( !IsValidWeaponId(weaponId) )
	{
		stackPushBool(qfalse);
		return;
	}

	gentity_t *player = &g_entities[id];
	if ( !G_IsPlaying(player) )
	{
		stackPushBool(qfalse);
		return;
	}

	playerState_t *ps = SV_GameClientNum(id);
	int clipIndex = BG_ClipForWeapon(weaponId);

	if ( clipIndex == 0 )
	{
		stackPushBool(qfalse);
		return;
	}

	// Clamp to valid range
	if ( clipAmmo < 0 )
		clipAmmo = 0;
	else if ( clipAmmo > BG_GetAmmoClipSize(clipIndex) )
		clipAmmo = BG_GetAmmoClipSize(clipIndex);

	ps->ammoclip[clipIndex] = clipAmmo;
	stackPushBool(qtrue);
}

void gsc_player_setweaponidammo(scr_entref_t ref)
{
	int id = ref.entnum;

	if ( id >= MAX_CLIENTS )
	{
		stackError("gsc_player_setweaponidammo() entity %i is not a player", id);
		stackPushUndefined();
		return;
	}

	int weaponId, ammo;
	if ( !stackGetParams("ii", &weaponId, &ammo) )
	{
		stackError("gsc_player_setweaponidammo() one or more arguments are undefined or have wrong types");
		stackPushUndefined();
		return;
	}

	if ( !IsValidWeaponId(weaponId) )
	{
		stackPushBool(qfalse);
		return;
	}

	gentity_t *player = &g_entities[id];
	if ( !G_IsPlaying(player) )
	{
		stackPushBool(qfalse);
		return;
	}

	playerState_t *ps = SV_GameClientNum(id);

	// Clamp to valid range
	if ( ammo < 0 )
		ammo = 0;

	// Clip-only weapons store ammo in ammoclip
	if ( BG_WeaponIsClipOnly(weaponId) )
	{
		int clipIndex = BG_ClipForWeapon(weaponId);
		if ( ammo > BG_GetAmmoClipSize(clipIndex) )
			ammo = BG_GetAmmoClipSize(clipIndex);
		ps->ammoclip[clipIndex] = ammo;
	}
	else
	{
		int ammoIndex = BG_AmmoForWeapon(weaponId);
		if ( ammoIndex == 0 )
		{
			stackPushBool(qfalse);
			return;
		}
		if ( ammo > BG_GetAmmoTypeMax(ammoIndex) )
			ammo = BG_GetAmmoTypeMax(ammoIndex);
		ps->ammo[ammoIndex] = ammo;
	}

	stackPushBool(qtrue);
}

// Phase 3: Slot-based Ammo Functions

void gsc_player_getslotidclipammo(scr_entref_t ref)
{
	int id = ref.entnum;

	if ( id >= MAX_CLIENTS )
	{
		stackError("gsc_player_getslotidclipammo() entity %i is not a player", id);
		stackPushUndefined();
		return;
	}

	int slotId;
	if ( !stackGetParams("i", &slotId) )
	{
		stackError("gsc_player_getslotidclipammo() argument is undefined or has a wrong type");
		stackPushUndefined();
		return;
	}

	if ( slotId < WEAPSLOT_NONE || slotId >= WEAPSLOT_NUM )
	{
		stackPushInt(0);
		return;
	}

	playerState_t *ps = SV_GameClientNum(id);
	int weaponId = ps->weaponslots[slotId];

	if ( weaponId == 0 )
	{
		stackPushInt(0);
		return;
	}

	int clipIndex = BG_ClipForWeapon(weaponId);
	if ( clipIndex == 0 )
	{
		stackPushInt(0);
		return;
	}

	stackPushInt(ps->ammoclip[clipIndex]);
}

void gsc_player_getslotidammo(scr_entref_t ref)
{
	int id = ref.entnum;

	if ( id >= MAX_CLIENTS )
	{
		stackError("gsc_player_getslotidammo() entity %i is not a player", id);
		stackPushUndefined();
		return;
	}

	int slotId;
	if ( !stackGetParams("i", &slotId) )
	{
		stackError("gsc_player_getslotidammo() argument is undefined or has a wrong type");
		stackPushUndefined();
		return;
	}

	if ( slotId < WEAPSLOT_NONE || slotId >= WEAPSLOT_NUM )
	{
		stackPushInt(0);
		return;
	}

	playerState_t *ps = SV_GameClientNum(id);
	int weaponId = ps->weaponslots[slotId];

	if ( weaponId == 0 )
	{
		stackPushInt(0);
		return;
	}

	// Clip-only weapons store ammo in ammoclip
	if ( BG_WeaponIsClipOnly(weaponId) )
	{
		int clipIndex = BG_ClipForWeapon(weaponId);
		stackPushInt(ps->ammoclip[clipIndex]);
	}
	else
	{
		int ammoIndex = BG_AmmoForWeapon(weaponId);
		if ( ammoIndex == 0 )
		{
			stackPushInt(0);
			return;
		}
		stackPushInt(ps->ammo[ammoIndex]);
	}
}

void gsc_player_setslotidclipammo(scr_entref_t ref)
{
	int id = ref.entnum;

	if ( id >= MAX_CLIENTS )
	{
		stackError("gsc_player_setslotidclipammo() entity %i is not a player", id);
		stackPushUndefined();
		return;
	}

	int slotId, clipAmmo;
	if ( !stackGetParams("ii", &slotId, &clipAmmo) )
	{
		stackError("gsc_player_setslotidclipammo() one or more arguments are undefined or have wrong types");
		stackPushUndefined();
		return;
	}

	if ( slotId < WEAPSLOT_NONE || slotId >= WEAPSLOT_NUM )
	{
		stackPushBool(qfalse);
		return;
	}

	gentity_t *player = &g_entities[id];
	if ( !G_IsPlaying(player) )
	{
		stackPushBool(qfalse);
		return;
	}

	playerState_t *ps = SV_GameClientNum(id);
	int weaponId = ps->weaponslots[slotId];

	if ( weaponId == 0 )
	{
		stackPushBool(qfalse);
		return;
	}

	int clipIndex = BG_ClipForWeapon(weaponId);
	if ( clipIndex == 0 )
	{
		stackPushBool(qfalse);
		return;
	}

	// Clamp to valid range
	if ( clipAmmo < 0 )
		clipAmmo = 0;
	else if ( clipAmmo > BG_GetAmmoClipSize(clipIndex) )
		clipAmmo = BG_GetAmmoClipSize(clipIndex);

	ps->ammoclip[clipIndex] = clipAmmo;
	stackPushBool(qtrue);
}

void gsc_player_setslotidammo(scr_entref_t ref)
{
	int id = ref.entnum;

	if ( id >= MAX_CLIENTS )
	{
		stackError("gsc_player_setslotidammo() entity %i is not a player", id);
		stackPushUndefined();
		return;
	}

	int slotId, ammo;
	if ( !stackGetParams("ii", &slotId, &ammo) )
	{
		stackError("gsc_player_setslotidammo() one or more arguments are undefined or have wrong types");
		stackPushUndefined();
		return;
	}

	if ( slotId < WEAPSLOT_NONE || slotId >= WEAPSLOT_NUM )
	{
		stackPushBool(qfalse);
		return;
	}

	gentity_t *player = &g_entities[id];
	if ( !G_IsPlaying(player) )
	{
		stackPushBool(qfalse);
		return;
	}

	playerState_t *ps = SV_GameClientNum(id);
	int weaponId = ps->weaponslots[slotId];

	if ( weaponId == 0 )
	{
		stackPushBool(qfalse);
		return;
	}

	// Clamp to valid range
	if ( ammo < 0 )
		ammo = 0;

	// Clip-only weapons store ammo in ammoclip
	if ( BG_WeaponIsClipOnly(weaponId) )
	{
		int clipIndex = BG_ClipForWeapon(weaponId);
		if ( ammo > BG_GetAmmoClipSize(clipIndex) )
			ammo = BG_GetAmmoClipSize(clipIndex);
		ps->ammoclip[clipIndex] = ammo;
	}
	else
	{
		int ammoIndex = BG_AmmoForWeapon(weaponId);
		if ( ammoIndex == 0 )
		{
			stackPushBool(qfalse);
			return;
		}
		if ( ammo > BG_GetAmmoTypeMax(ammoIndex) )
			ammo = BG_GetAmmoTypeMax(ammoIndex);
		ps->ammo[ammoIndex] = ammo;
	}

	stackPushBool(qtrue);
}

// Phase 4: Weapon Management

void gsc_player_setweaponidinslotid(scr_entref_t ref)
{
	int id = ref.entnum;

	if ( id >= MAX_CLIENTS )
	{
		stackError("gsc_player_setweaponidinslotid() entity %i is not a player", id);
		stackPushUndefined();
		return;
	}

	int slotId, weaponId;
	if ( !stackGetParams("ii", &slotId, &weaponId) )
	{
		stackError("gsc_player_setweaponidinslotid() one or more arguments are undefined or have wrong types");
		stackPushUndefined();
		return;
	}

	if ( slotId <= WEAPSLOT_NONE || slotId >= WEAPSLOT_NUM )
	{
		stackPushBool(qfalse);
		return;
	}

	if ( weaponId != 0 && !IsValidWeaponId(weaponId) )
	{
		stackPushBool(qfalse);
		return;
	}

	gentity_t *player = &g_entities[id];
	if ( !G_IsPlaying(player) )
	{
		stackPushBool(qfalse);
		return;
	}

	playerState_t *ps = SV_GameClientNum(id);
	ps->weaponslots[slotId] = (byte)weaponId;

	// Ensure the player actually owns the weapon so it can be used.
	if ( weaponId != 0 )
	{
		COM_BitSet(ps->weapons, weaponId);
	}

	stackPushBool(qtrue);
}

