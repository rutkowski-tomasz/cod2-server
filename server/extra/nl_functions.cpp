#include "nl.hpp"
#include "gsc_graph.hpp"

static scr_function_t functions[] =
{
	{"graphCreate", gsc_graph_create_graph, 0},
	{"graphRemove", gsc_graph_remove_graph, 0},
	{"graphRemoveAll", gsc_graph_remove_graphs, 0},
	{"graphAddNode", gsc_graph_add_node, 0},
	{"graphGetNodeProperties", gsc_graph_get_node_properties, 0},
	{"graphGetNodeOrigin", gsc_graph_get_node_origin, 0},
	{"graphSetNodeOrigin", gsc_graph_set_node_origin, 0},
	{"graphSetNodeType", gsc_graph_set_node_type, 0},
	{"graphGetNodeIdsAccessibleFrom", gsc_graph_get_node_ids_accessible_from, 0},
	{"graphGetNodeIdsAccessibleTo", gsc_graph_get_node_ids_accessible_to, 0},
	{"graphGetAllNodes", gsc_graph_get_all_nodes, 0},
	{"graphRemoveNode", gsc_graph_remove_node, 0},
	{"graphAddEdge", gsc_graph_add_edge, 0},
	{"graphGetEdgeProperties", gsc_graph_get_edge_properties, 0},
	{"graphSetEdgeType", gsc_graph_set_edge_type, 0},
	{"graphGetEdgeType", gsc_graph_get_edge_type, 0},
	{"graphRemoveEdge", gsc_graph_remove_edge, 0},
	{"graphFindPath", gsc_graph_find_path_astar, 0},
	{"graphPrecomputePathsToNode", gsc_graph_precompute_paths_to_node, 0},
	{"graphFindClosestNode", gsc_graph_find_closest_node, 0},
	{"graphFindClosestEdge", gsc_graph_find_closest_edge, 0},
	{"graphGetAllEdges", gsc_graph_get_all_edges, 0},
	{"graphAutodiscover", gsc_graph_autodiscover, 0},

	{"getPlayersByViewOriginInRange", gsc_level_getplayersbyvieworigininrange, 0},
	{"getPlayersInRange", gsc_level_getplayersinrange, 0},
	{"getClosestPlayerInRange", gsc_level_getclosestplayerinrange, 0},
	{"getClosestPlayerByViewOriginInRange", gsc_level_getclosestplayerbyvieworigininrange, 0},

	{"takePrintedMessages", gsc_prints_takeprintedmessages, 0},

	{"collapseColors", gsc_utils_collapsecolors, 0},
	{"stripColors", gsc_utils_stripcolors, 0},
	{"sha256", gsc_utils_sha256, 0},

	{"getWeaponIdClipAmmoSize", gsc_weapons_getweaponidclipammosize, 0},
	{"getWeaponIdAmmoSize", gsc_weapons_getweaponidammosize, 0},
	{"getWeaponIdAmmoStartSize", gsc_weapons_getweaponidammostartsize, 0},
	{"weaponNameToId", gsc_weapons_weaponnametoid, 0},
	{NULL, NULL, 0}
};

static scr_method_t methods[] =
{
	{"getCurrentSlotId", gsc_player_getcurrentslotid, 0},
	{"getCurrentWeaponId", gsc_player_getcurrentweaponid, 0},
	{"getSlotIdAmmo", gsc_player_getslotidammo, 0},
	{"getSlotIdClipAmmo", gsc_player_getslotidclipammo, 0},
	{"getWeaponIdAmmo", gsc_player_getweaponidammo, 0},
	{"getWeaponIdClipAmmo", gsc_player_getweaponidclipammo, 0},
	{"getWeaponIdInSlotId", gsc_player_getweaponidinslotid, 0},
	{"setSlotIdAmmo", gsc_player_setslotidammo, 0},
	{"setSlotIdClipAmmo", gsc_player_setslotidclipammo, 0},
	{"setWeaponIdAmmo", gsc_player_setweaponidammo, 0},
	{"setWeaponIdClipAmmo", gsc_player_setweaponidclipammo, 0},
	{"setWeaponIdInSlotId", gsc_player_setweaponidinslotid, 0},
	{"getLegsAnimation", gsc_player_getlegsanimation, 0},
	{"getTorsoAnimation", gsc_player_gettorsoanimation, 0},
	{NULL, NULL, 0}
};

xfunction_t Scr_GetExtraFunction(const char **fname, int *fdev)
{
	for ( int i = 0; functions[i].name; i++ )
	{
		if ( strcasecmp(*fname, functions[i].name) )
			continue;

		*fname = functions[i].name;
		*fdev = functions[i].developer;
		return functions[i].call;
	}

	return NULL;
}

xmethod_t Scr_GetExtraMethod(const char **fname, qboolean *fdev)
{
	for ( int i = 0; methods[i].name; i++ )
	{
		if ( strcasecmp(*fname, methods[i].name) )
			continue;

		*fname = methods[i].name;
		*fdev = methods[i].developer;
		return methods[i].call;
	}

	return NULL;
}
