#include "nl.hpp"

static void gsc_level_findplayersinrange(const char *functionName, bool useViewOrigin, bool closestOnly)
{
	vec3_t origin;
	float maxDistSq = 0.0f;
	bool hasMaxDist = false;
	int filterTeam = -1;
	int traceContentMask = 0;
	bool hasTraceCheck = false;
	int args = Scr_GetNumParam();

	if ( args < 1 || Scr_GetType(0) != VAR_VECTOR )
	{
		stackError("%s() requires origin", functionName);
		stackPushUndefined();
		return;
	}

	Scr_GetVector(0, origin);

	if ( args > 1 && Scr_GetType(1) != VAR_UNDEFINED )
	{
		if ( Scr_GetType(1) != VAR_FLOAT && Scr_GetType(1) != VAR_INTEGER )
		{
			stackError("%s() max distance square must be a number", functionName);
			stackPushUndefined();
			return;
		}

		maxDistSq = Scr_GetFloat(1);
		hasMaxDist = true;
	}

	if ( hasMaxDist && maxDistSq < 0.0f )
	{
		stackError("%s() max distance square must be >= 0", functionName);
		stackPushUndefined();
		return;
	}

	if ( args > 2 && Scr_GetType(2) != VAR_UNDEFINED )
	{
		if ( Scr_GetType(2) != VAR_INTEGER )
		{
			stackError("%s() team filter must be an int", functionName);
			stackPushUndefined();
			return;
		}

		filterTeam = Scr_GetInt(2);
	}

	if ( args > 3 && Scr_GetType(3) != VAR_UNDEFINED )
	{
		if ( Scr_GetType(3) != VAR_INTEGER )
		{
			stackError("%s() content mask must be an int", functionName);
			stackPushUndefined();
			return;
		}

		traceContentMask = Scr_GetInt(3);
		hasTraceCheck = true;
	}

	gentity_t *closestPlayer = NULL;
	float closestDistSq = 0.0f;

	if ( !closestOnly )
		stackPushArray();

	for ( int i = 0; i < level.maxclients; ++i )
	{
		gentity_t *player = &g_entities[i];
		gclient_t *client = player->client;
		vec3_t playerOrigin;
		float distSq;

		if ( !client || client->sess.connected != CON_CONNECTED || client->sess.sessionState != STATE_PLAYING )
			continue;

		if ( player->health <= 0 )
			continue;

		if ( filterTeam >= 0 && client->sess.cs.team != filterTeam )
			continue;

		if ( useViewOrigin )
			G_GetPlayerViewOrigin(player, playerOrigin);
		else
			VectorCopy(player->r.currentOrigin, playerOrigin);

		distSq = Get3DDistanceSquared(origin, playerOrigin);

		if ( hasMaxDist && distSq > maxDistSq )
			continue;

		if ( hasTraceCheck && !G_LocationalTracePassed(origin, playerOrigin, player->s.number, traceContentMask) )
			continue;

		if ( closestOnly )
		{
			if ( !closestPlayer || distSq < closestDistSq )
			{
				closestPlayer = player;
				closestDistSq = distSq;
			}
		}
		else
		{
			stackPushEntity(player);
			stackPushArrayLast();
		}
	}

	if ( !closestOnly )
		return;

	if ( closestPlayer )
		stackPushEntity(closestPlayer);
	else
		stackPushUndefined();
}

void gsc_level_getplayersinrange()
{
	gsc_level_findplayersinrange("gsc_level_getplayersinrange", false, false);
}

void gsc_level_getplayersbyvieworigininrange()
{
	gsc_level_findplayersinrange("gsc_level_getplayersbyvieworigininrange", true, false);
}

void gsc_level_getclosestplayerinrange()
{
	gsc_level_findplayersinrange("gsc_level_getclosestplayerinrange", false, true);
}

void gsc_level_getclosestplayerbyvieworigininrange()
{
	gsc_level_findplayersinrange("gsc_level_getclosestplayerbyvieworigininrange", true, true);
}
