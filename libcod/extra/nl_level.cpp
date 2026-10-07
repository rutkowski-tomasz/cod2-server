#include "nl.hpp"

void gsc_level_getplayersinrange()
{
	vec3_t origin;
	float maxDistSq = 0.0f;
	bool hasMaxDist = false;
	int filterTeam = -1;
	int traceContentMask = 0;
	int hasTraceCheck = 0;
	int args = Scr_GetNumParam();

	if ( args < 1 || Scr_GetType(0) != VAR_VECTOR )
	{
		stackError("gsc_level_getplayersinrange() requires origin");
		stackPushUndefined();
		return;
	}

	Scr_GetVector(0, origin);

	if ( args > 1 && Scr_GetType(1) != VAR_UNDEFINED )
	{
		if ( Scr_GetType(1) != VAR_FLOAT && Scr_GetType(1) != VAR_INTEGER )
		{
			stackError("gsc_level_getplayersinrange() max distance square must be a number");
			stackPushUndefined();
			return;
		}

		maxDistSq = Scr_GetFloat(1);
		hasMaxDist = true;
	}

	if ( hasMaxDist && maxDistSq < 0.0f )
	{
		stackError("gsc_level_getplayersinrange() max distance square must be >= 0");
		stackPushUndefined();
		return;
	}

	if ( args > 2 && Scr_GetType(2) != VAR_UNDEFINED )
	{
		if ( Scr_GetType(2) != VAR_INTEGER )
		{
			stackError("gsc_level_getplayersinrange() team filter must be an int");
			stackPushUndefined();
			return;
		}

		filterTeam = Scr_GetInt(2);
	}

	if ( args > 3 && Scr_GetType(3) != VAR_UNDEFINED )
	{
		if ( Scr_GetType(3) != VAR_INTEGER )
		{
			stackError("gsc_level_getplayersinrange() content mask must be an int");
			stackPushUndefined();
			return;
		}

		traceContentMask = Scr_GetInt(3);
		hasTraceCheck = 1;
	}

	stackPushArray();

	for ( int i = 0; i < level.maxclients; ++i )
	{
		gentity_t *player = &g_entities[i];
		gclient_t *client = player->client;
		float dx, dy, dz;
		float distSq;

		if ( !client || client->sess.connected != CON_CONNECTED || client->sess.sessionState != STATE_PLAYING )
			continue;

		if ( player->health <= 0 )
			continue;

		if ( filterTeam >= 0 && client->sess.cs.team != filterTeam )
			continue;

		dx = player->r.currentOrigin[0] - origin[0];
		dy = player->r.currentOrigin[1] - origin[1];
		dz = player->r.currentOrigin[2] - origin[2];
		distSq = dx * dx + dy * dy + dz * dz;

		if ( hasMaxDist && distSq > maxDistSq )
			continue;

		if ( hasTraceCheck && !G_LocationalTracePassed(origin, player->r.currentOrigin, player->s.number, traceContentMask) )
			continue;

		stackPushEntity(player);
		stackPushArrayLast();
	}
}

void gsc_level_getplayersbyvieworigininrange()
{
	vec3_t origin;
	float maxDistSq = 0.0f;
	bool hasMaxDist = false;
	int filterTeam = -1;
	int traceContentMask = 0;
	int hasTraceCheck = 0;
	int args = Scr_GetNumParam();

	if ( args < 1 || Scr_GetType(0) != VAR_VECTOR )
	{
		stackError("gsc_level_getplayersbyvieworigininrange() requires origin");
		stackPushUndefined();
		return;
	}

	Scr_GetVector(0, origin);

	if ( args > 1 && Scr_GetType(1) != VAR_UNDEFINED )
	{
		if ( Scr_GetType(1) != VAR_FLOAT && Scr_GetType(1) != VAR_INTEGER )
		{
			stackError("gsc_level_getplayersbyvieworigininrange() max distance square must be a number");
			stackPushUndefined();
			return;
		}

		maxDistSq = Scr_GetFloat(1);
		hasMaxDist = true;
	}

	if ( hasMaxDist && maxDistSq < 0.0f )
	{
		stackError("gsc_level_getplayersbyvieworigininrange() max distance square must be >= 0");
		stackPushUndefined();
		return;
	}

	if ( args > 2 && Scr_GetType(2) != VAR_UNDEFINED )
	{
		if ( Scr_GetType(2) != VAR_INTEGER )
		{
			stackError("gsc_level_getplayersbyvieworigininrange() team filter must be an int");
			stackPushUndefined();
			return;
		}

		filterTeam = Scr_GetInt(2);
	}

	if ( args > 3 && Scr_GetType(3) != VAR_UNDEFINED )
	{
		if ( Scr_GetType(3) != VAR_INTEGER )
		{
			stackError("gsc_level_getplayersbyvieworigininrange() content mask must be an int");
			stackPushUndefined();
			return;
		}

		traceContentMask = Scr_GetInt(3);
		hasTraceCheck = 1;
	}

	stackPushArray();

	for ( int i = 0; i < level.maxclients; ++i )
	{
		gentity_t *player = &g_entities[i];
		gclient_t *client = player->client;
		vec3_t playerViewOrigin;
		float dx, dy, dz;
		float distSq;

		if ( !client || client->sess.connected != CON_CONNECTED || client->sess.sessionState != STATE_PLAYING )
			continue;

		if ( player->health <= 0 )
			continue;

		if ( filterTeam >= 0 && client->sess.cs.team != filterTeam )
			continue;

		G_GetPlayerViewOrigin(player, playerViewOrigin);

		dx = playerViewOrigin[0] - origin[0];
		dy = playerViewOrigin[1] - origin[1];
		dz = playerViewOrigin[2] - origin[2];
		distSq = dx * dx + dy * dy + dz * dz;

		if ( hasMaxDist && distSq > maxDistSq )
			continue;

		if ( hasTraceCheck && !G_LocationalTracePassed(origin, playerViewOrigin, player->s.number, traceContentMask) )
			continue;

		stackPushEntity(player);
		stackPushArrayLast();
	}
}

void gsc_level_getclosestplayerinrange()
{
	vec3_t origin;
	float maxDistSq = 0.0f;
	bool hasMaxDist = false;
	int filterTeam = -1;
	int traceContentMask = 0;
	int hasTraceCheck = 0;
	int args = Scr_GetNumParam();

	if ( args < 1 || Scr_GetType(0) != VAR_VECTOR )
	{
		stackError("gsc_level_getclosestplayerinrange() requires origin");
		stackPushUndefined();
		return;
	}

	Scr_GetVector(0, origin);

	if ( args > 1 && Scr_GetType(1) != VAR_UNDEFINED )
	{
		if ( Scr_GetType(1) != VAR_FLOAT && Scr_GetType(1) != VAR_INTEGER )
		{
			stackError("gsc_level_getclosestplayerinrange() max distance square must be a number");
			stackPushUndefined();
			return;
		}

		maxDistSq = Scr_GetFloat(1);
		hasMaxDist = true;
	}

	if ( hasMaxDist && maxDistSq < 0.0f )
	{
		stackError("gsc_level_getclosestplayerinrange() max distance square must be >= 0");
		stackPushUndefined();
		return;
	}

	if ( args > 2 && Scr_GetType(2) != VAR_UNDEFINED )
	{
		if ( Scr_GetType(2) != VAR_INTEGER )
		{
			stackError("gsc_level_getclosestplayerinrange() team filter must be an int");
			stackPushUndefined();
			return;
		}

		filterTeam = Scr_GetInt(2);
	}

	if ( args > 3 && Scr_GetType(3) != VAR_UNDEFINED )
	{
		if ( Scr_GetType(3) != VAR_INTEGER )
		{
			stackError("gsc_level_getclosestplayerinrange() content mask must be an int");
			stackPushUndefined();
			return;
		}

		traceContentMask = Scr_GetInt(3);
		hasTraceCheck = 1;
	}

	gentity_t *closestPlayer = NULL;
	float closestDistSq = hasMaxDist ? maxDistSq : 0.0f;
	bool foundPlayer = false;

	for ( int i = 0; i < level.maxclients; ++i )
	{
		gentity_t *player = &g_entities[i];
		gclient_t *client = player->client;
		float dx, dy, dz;
		float distSq;

		if ( !client || client->sess.connected != CON_CONNECTED || client->sess.sessionState != STATE_PLAYING )
			continue;

		if ( player->health <= 0 )
			continue;

		if ( filterTeam >= 0 && client->sess.cs.team != filterTeam )
			continue;

		dx = player->r.currentOrigin[0] - origin[0];
		dy = player->r.currentOrigin[1] - origin[1];
		dz = player->r.currentOrigin[2] - origin[2];
		distSq = dx * dx + dy * dy + dz * dz;

		if ( hasMaxDist && distSq > maxDistSq )
			continue;

		if ( hasTraceCheck && !G_LocationalTracePassed(origin, player->r.currentOrigin, player->s.number, traceContentMask) )
			continue;

		if ( !foundPlayer || distSq < closestDistSq )
		{
			closestPlayer = player;
			closestDistSq = distSq;
			foundPlayer = true;
		}
	}

	if ( !foundPlayer )
	{
		stackPushUndefined();
		return;
	}

	stackPushEntity(closestPlayer);
}

void gsc_level_getclosestplayerbyvieworigininrange()
{
	vec3_t origin;
	float maxDistSq = 0.0f;
	bool hasMaxDist = false;
	int filterTeam = -1;
	int traceContentMask = 0;
	int hasTraceCheck = 0;
	int args = Scr_GetNumParam();

	if ( args < 1 || Scr_GetType(0) != VAR_VECTOR )
	{
		stackError("gsc_level_getclosestplayerbyvieworigininrange() requires origin");
		stackPushUndefined();
		return;
	}

	Scr_GetVector(0, origin);

	if ( args > 1 && Scr_GetType(1) != VAR_UNDEFINED )
	{
		if ( Scr_GetType(1) != VAR_FLOAT && Scr_GetType(1) != VAR_INTEGER )
		{
			stackError("gsc_level_getclosestplayerbyvieworigininrange() max distance square must be a number");
			stackPushUndefined();
			return;
		}

		maxDistSq = Scr_GetFloat(1);
		hasMaxDist = true;
	}

	if ( hasMaxDist && maxDistSq < 0.0f )
	{
		stackError("gsc_level_getclosestplayerbyvieworigininrange() max distance square must be >= 0");
		stackPushUndefined();
		return;
	}

	if ( args > 2 && Scr_GetType(2) != VAR_UNDEFINED )
	{
		if ( Scr_GetType(2) != VAR_INTEGER )
		{
			stackError("gsc_level_getclosestplayerbyvieworigininrange() team filter must be an int");
			stackPushUndefined();
			return;
		}

		filterTeam = Scr_GetInt(2);
	}

	if ( args > 3 && Scr_GetType(3) != VAR_UNDEFINED )
	{
		if ( Scr_GetType(3) != VAR_INTEGER )
		{
			stackError("gsc_level_getclosestplayerbyvieworigininrange() content mask must be an int");
			stackPushUndefined();
			return;
		}

		traceContentMask = Scr_GetInt(3);
		hasTraceCheck = 1;
	}

	gentity_t *closestPlayer = NULL;
	float closestDistSq = hasMaxDist ? maxDistSq : 0.0f;
	bool foundPlayer = false;

	for ( int i = 0; i < level.maxclients; ++i )
	{
		gentity_t *player = &g_entities[i];
		gclient_t *client = player->client;
		vec3_t playerViewOrigin;
		float dx, dy, dz;
		float distSq;

		if ( !client || client->sess.connected != CON_CONNECTED || client->sess.sessionState != STATE_PLAYING )
			continue;

		if ( player->health <= 0 )
			continue;

		if ( filterTeam >= 0 && client->sess.cs.team != filterTeam )
			continue;

		G_GetPlayerViewOrigin(player, playerViewOrigin);

		dx = playerViewOrigin[0] - origin[0];
		dy = playerViewOrigin[1] - origin[1];
		dz = playerViewOrigin[2] - origin[2];
		distSq = dx * dx + dy * dy + dz * dz;

		if ( hasMaxDist && distSq > maxDistSq )
			continue;

		if ( hasTraceCheck && !G_LocationalTracePassed(origin, playerViewOrigin, player->s.number, traceContentMask) )
			continue;

		if ( !foundPlayer || distSq < closestDistSq )
		{
			closestPlayer = player;
			closestDistSq = distSq;
			foundPlayer = true;
		}
	}

	if ( !foundPlayer )
	{
		stackPushUndefined();
		return;
	}

	stackPushEntity(closestPlayer);
}

