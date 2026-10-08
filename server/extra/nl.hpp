#ifndef _NL_HPP_
#define _NL_HPP_

#include "../gsc.hpp"
#include "../utils.hpp"
#include <stdint.h>
#include <algorithm>
#include <functional>

bool FloatsApproximatelyEqual(float a, float b);
float Get3DDistance(float *a, float *b);
float Get3DDistanceSquared(float *a, float *b);
void ProjectPointOnLine(float *a, float *b, float *p, float *o);

size_t HashCombine(size_t seed, float v);

void Sha256Bytes(const uint8_t *data, size_t len, uint8_t digest[32]);
void Sha256Hex(const uint8_t *data, size_t len, char hex[65]);

void gsc_level_getplayersbyvieworigininrange();
void gsc_level_getplayersinrange();
void gsc_level_getclosestplayerbyvieworigininrange();
void gsc_level_getclosestplayerinrange();

void gsc_player_getcurrentslotid(scr_entref_t ref);
void gsc_player_getcurrentweaponid(scr_entref_t ref);
void gsc_player_getslotidammo(scr_entref_t ref);
void gsc_player_getslotidclipammo(scr_entref_t ref);
void gsc_player_getweaponidammo(scr_entref_t ref);
void gsc_player_getweaponidclipammo(scr_entref_t ref);
void gsc_player_getweaponidinslotid(scr_entref_t ref);
void gsc_player_setslotidammo(scr_entref_t ref);
void gsc_player_setslotidclipammo(scr_entref_t ref);
void gsc_player_setweaponidammo(scr_entref_t ref);
void gsc_player_setweaponidclipammo(scr_entref_t ref);
void gsc_player_setweaponidinslotid(scr_entref_t ref);

void gsc_utils_collapsecolors();
void gsc_utils_stripcolors();
void gsc_utils_sha256();

void gsc_weapons_getweaponidclipammosize();
void gsc_weapons_getweaponidammosize();
void gsc_weapons_getweaponidammostartsize();
void gsc_weapons_weaponnametoid();

#endif
