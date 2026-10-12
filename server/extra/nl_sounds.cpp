#include "nl.hpp"
#include <deque>
#include <string>

// A server that never takes the sounds keeps only the latest ones.
#define MAX_PLAYED_SOUNDS 256

struct PlayedSound
{
	std::string alias;
	int client;
	vec3_t origin;
};

static std::deque<PlayedSound> playedSounds;

// Calls the game's method `name`, which ours of the same name replaces in scripts. The game's checks the arguments,
// so a wrong call stops the script there, before the sound is kept.
static void callGameMethod(const char *name, scr_entref_t ref)
{
	qboolean developer;
	Scr_GetMethod(&name, &developer)(ref);
}

static void recordPlayedSound(int client, const vec3_t origin)
{
	if ( playedSounds.size() == MAX_PLAYED_SOUNDS )
		playedSounds.pop_front();

	PlayedSound sound = { Scr_GetString(0), client, { origin[0], origin[1], origin[2] } };
	playedSounds.push_back(sound);
}

void gsc_sounds_playsound(scr_entref_t ref)
{
	callGameMethod("playsound", ref);
	recordPlayedSound(-1, g_entities[ref.entnum].r.currentOrigin);
}

void gsc_sounds_playsoundasmaster(scr_entref_t ref)
{
	callGameMethod("playsoundasmaster", ref);
	recordPlayedSound(-1, g_entities[ref.entnum].r.currentOrigin);
}

void gsc_sounds_playlocalsound(scr_entref_t ref)
{
	callGameMethod("playlocalsound", ref);
	recordPlayedSound(ref.entnum, vec3_origin);
}

void gsc_sounds_takeplayedsounds()
{
	stackPushArray();
	for ( const PlayedSound &sound : playedSounds )
	{
		stackPushArray();
		stackPushString(sound.alias.c_str());
		addArrayKey("alias");
		if ( sound.client >= 0 )
		{
			stackPushInt(sound.client);
			addArrayKey("client");
		}
		else
		{
			stackPushVector((float *)sound.origin);
			addArrayKey("origin");
		}
		stackPushArrayLast();
	}
	playedSounds.clear();
}

void gsc_sounds_getloopsounds()
{
	gentity_t *ent = g_entities;

	stackPushArray();
	for ( int i = 0; i < level.num_entities; i++, ent++ )
	{
		if ( !ent->r.inuse || !ent->s.loopSound )
			continue;

		stackPushArray();
		stackPushInt(i);
		addArrayKey("entity");
		stackPushString(SV_GetConfigstringConst(CS_SOUND_ALIASES + ent->s.loopSound));
		addArrayKey("alias");
		stackPushVector(ent->r.currentOrigin);
		addArrayKey("origin");
		stackPushArrayLast();
	}
}

// ambientPlay sets the configstring to `n\<alias>\t\<time>`, ambientStop empties it.
void gsc_sounds_getambientsound()
{
	const char *alias = Info_ValueForKey(SV_GetConfigstringConst(CS_AMBIENT), "n");
	stackPushString(alias);
}
