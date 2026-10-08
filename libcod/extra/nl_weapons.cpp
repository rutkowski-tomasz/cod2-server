#include "nl.hpp"

void gsc_weapons_weaponnametoid()
{
	char *name;

	if ( !stackGetParams("s", &name) )
	{
		stackError("weaponNameToId() argument is undefined or has a wrong type");
		stackPushUndefined();
		return;
	}

	int weaponId = BG_FindWeaponIndexForName(name);
	stackPushInt(weaponId);
}

void gsc_weapons_getweaponidclipammosize()
{
	int weaponId;

	if ( !stackGetParams("i", &weaponId) )
	{
		stackError("gsc_weapons_getweaponidclipammosize() argument is undefined or has a wrong type");
		stackPushUndefined();
		return;
	}

	if ( !IsValidWeaponId(weaponId) )
	{
		stackPushUndefined();
		return;
	}

	int clipIndex = BG_ClipForWeapon(weaponId);
	if ( clipIndex == 0 )
	{
		stackPushInt(0);
		return;
	}

	stackPushInt(BG_GetAmmoClipSize(clipIndex));
}

void gsc_weapons_getweaponidammosize()
{
	int weaponId;

	if ( !stackGetParams("i", &weaponId) )
	{
		stackError("gsc_weapons_getweaponidammosize() argument is undefined or has a wrong type");
		stackPushUndefined();
		return;
	}

	if ( !IsValidWeaponId(weaponId) )
	{
		stackPushUndefined();
		return;
	}

	if ( BG_WeaponIsClipOnly(weaponId) )
	{
		int clipIndex = BG_ClipForWeapon(weaponId);
		if ( clipIndex == 0 )
		{
			stackPushInt(0);
			return;
		}

		stackPushInt(BG_GetAmmoClipSize(clipIndex));
		return;
	}

	int ammoIndex = BG_AmmoForWeapon(weaponId);
	if ( ammoIndex == 0 )
	{
		stackPushInt(0);
		return;
	}

	stackPushInt(BG_GetAmmoTypeMax(ammoIndex));
}

void gsc_weapons_getweaponidammostartsize()
{
	int weaponId;

	if ( !stackGetParams("i", &weaponId) )
	{
		stackError("gsc_weapons_getweaponidammostartsize() argument is undefined or has a wrong type");
		stackPushUndefined();
		return;
	}

	if ( !IsValidWeaponId(weaponId) )
	{
		stackPushUndefined();
		return;
	}

	WeaponDef_t *weapon = BG_GetWeaponDef(weaponId);
	stackPushInt(weapon->iStartAmmo);
}

