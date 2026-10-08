#include <iostream>
#include <stdio.h>
#include <math.h>
#include <limits>
#include <climits>
#include <queue>
#include <unordered_set>
#include <utility>

using namespace std;

#include "gsc_graph.hpp" // See header for copyright and usage information
#include "nl.hpp"

extern vector<AStarGraph> AStarGraphs;

//
// GraphEdge class methods
//

// Value updater for copy operations, like custom copy operator
void AStarGraphEdge::Update(AStarGraphNode *_start, AStarGraphNode *_end, int _type, float _cost)
{
	start = _start;
	end = _end;
	type = _type;
	cost = _cost;
}

//
// GraphNode class methods
//

// Given this node, what does it cost to move to the given connected node
float AStarGraphNode::GetCostToNext(AStarGraphNode& nextNode)
{
#if USE_FSA_MEMORY
	for ( unsigned int i = 0; i < numEdges; i++ )
	{
		if ( edges[i].end->id == nextNode.id )
			return edges[i].cost;
	}
#else
	for ( auto edge = begin(edges); edge != end(edges); ++edge )
	{
		if ( edge->end->id == nextNode.id )
			return edge->cost;
	}
#endif
	return numeric_limits<float>::infinity(); // We should not end up here
}

// Here's the heuristic function that estimates the distance from a Node
// to the Goal
float AStarGraphNode::GetCostToGoalEstimate(AStarGraphNode& goalNode)
{
	// Euclidean distance
	return Get3DDistance(origin, goalNode.origin);
}

size_t AStarGraphNode::GetHash(void)
{
	return HashCombine(HashCombine(hash<float>{}(origin[0]), origin[1]), origin[2]);
}

// This generates the successors to the given Node. It uses a helper function
// called AddSuccessor to give the successors to the AStar class. The A*
// specific initialisation is done for each node internally, so here we just
// set the state information that is specific to this application
bool AStarGraphNode::GetSuccessors(
	AStarSearch<AStarGraphNode>* astarSearch,
	AStarGraphNode* parentNode,
	vector<unsigned int>* skippedNodes,
	unsigned int skippedNodeTypes,
	unsigned int skippedEdgeTypes)
{
#if USE_FSA_MEMORY
	unsigned int i = 0;
	for ( auto edge = begin(edges); i < numEdges; ++edge, ++i )
#else
	for ( auto edge = begin(edges); edge != end(edges); ++edge )
#endif
	{
		if ( edge->type & skippedEdgeTypes )
			continue;

		if ( edge->end->type & skippedNodeTypes )
			continue;

		bool skip = false;
		for ( auto skippedNode = begin(*skippedNodes); skippedNode != end(*skippedNodes); ++skippedNode )
		{
			if ( *skippedNode == edge->end->id )
			{
				skip = true;
				break;
			}
		}
		if ( skip )
			continue;

		astarSearch->AddSuccessor(*edge->end);
	}

	return true;
}

bool AStarGraphNode::IsSameNode(AStarGraphNode &checkNode)
{
	if ( id == checkNode.id )
		return true;

	return false;
}

bool AStarGraphNode::IsSameNodeByOrigin(AStarGraphNode &checkNode)
{
	if ( FloatsApproximatelyEqual(origin[0], checkNode.origin[0]) &&
	     FloatsApproximatelyEqual(origin[1], checkNode.origin[1]) &&
		 FloatsApproximatelyEqual(origin[2], checkNode.origin[2]) )
	{
		return true;
	}

	return false;
}

//
// AStarGraph class methods
//

AStarGraphNode* AStarGraph::GetNodeById(unsigned int id)
{
	auto it = nodeMap.find(id);
	if ( it != nodeMap.end() )
		return it->second;

	return NULL;
}

int AStarGraph::GetNodeIndex(AStarGraphNode* searchNode)
{
	for ( size_t i = 0; i < nodes.size(); i++ )
	{
		if ( nodes[i].get() == searchNode )
			return static_cast<int>(i);
	}
	return -1;
}

//
// Helper functions
//

AStarGraph* GetGraphById(unsigned int id)
{
	for ( auto graph = begin(AStarGraphs); graph != end(AStarGraphs); ++graph )
	{
		if ( graph->id == id )
		{
			return &(*graph);
		}
	}
	return NULL;
}

struct FastHeapNode
{
	int index;
	float f;
};

struct FastHeapCompare
{
	bool operator()(const FastHeapNode& a, const FastHeapNode& b) const
	{
		return a.f > b.f;
	}
};

struct IncomingEdge
{
	int fromIndex;
	float cost;
	int type;
};

static void InvalidatePrecompute(AStarGraph& graph)
{
	graph.precomputedPaths.clear();
}

static bool BuildPathFromParents(
	AStarGraph& graph,
	const std::vector<int>& parentByIndex,
	size_t startIndex,
	size_t goalIndex,
	std::vector<unsigned int>& outPath)
{
	outPath.clear();

	if ( startIndex == goalIndex )
		return true;

	size_t current = startIndex;
	size_t safety = graph.nodes.size();

	while ( current != goalIndex && safety-- > 0 )
	{
		int next = parentByIndex[current];
		if ( next < 0 )
			return false;

		current = static_cast<size_t>(next);
		outPath.push_back(graph.nodes[current]->id);
	}

	return current == goalIndex;
}

static bool BuildPathFromParentsReverse(
	AStarGraph& graph,
	const std::vector<int>& parentByIndex,
	size_t startIndex,
	size_t goalIndex,
	std::vector<unsigned int>& outPath)
{
	outPath.clear();

	if ( startIndex == goalIndex )
		return true;

	std::vector<unsigned int> reversed;
	size_t current = goalIndex;
	size_t safety = graph.nodes.size();

	while ( current != startIndex && safety-- > 0 )
	{
		reversed.push_back(graph.nodes[current]->id);
		int next = parentByIndex[current];
		if ( next < 0 )
			return false;
		current = static_cast<size_t>(next);
	}

	if ( current != startIndex )
		return false;

	for ( auto it = reversed.rbegin(); it != reversed.rend(); ++it )
		outPath.push_back(*it);

	return true;
}

static bool FindPathAStarFast(
	AStarGraph& graph,
	unsigned int startId,
	unsigned int endId,
	const std::vector<unsigned int>& skipNodes,
	unsigned int skipNodeTypes,
	unsigned int skipEdgeTypes,
	std::vector<unsigned int>& outPath)
{
	outPath.clear();

	auto itStart = graph.nodeIndexById.find(startId);
	auto itGoal = graph.nodeIndexById.find(endId);
	if ( itStart == graph.nodeIndexById.end() || itGoal == graph.nodeIndexById.end() )
		return false;

	const size_t startIndex = itStart->second;
	const size_t goalIndex = itGoal->second;

	if ( startIndex == goalIndex )
		return true;

	std::unordered_set<unsigned int> skippedNodeSet;
	if ( !skipNodes.empty() )
	{
		skippedNodeSet.reserve(skipNodes.size());
		for ( auto id : skipNodes )
			skippedNodeSet.insert(id);
	}

	const size_t nodeCount = graph.nodes.size();
	std::vector<float> gScore(nodeCount, std::numeric_limits<float>::infinity());
	std::vector<float> fScore(nodeCount, std::numeric_limits<float>::infinity());
	std::vector<int> parent(nodeCount, -1);
	std::vector<bool> closed(nodeCount, false);

	auto* goalNode = graph.nodes[goalIndex].get();

	std::priority_queue<FastHeapNode, std::vector<FastHeapNode>, FastHeapCompare> openHeap;

	gScore[startIndex] = 0.0f;
	fScore[startIndex] = Get3DDistance(graph.nodes[startIndex]->origin, goalNode->origin);
	openHeap.push({static_cast<int>(startIndex), fScore[startIndex]});

	while ( !openHeap.empty() )
	{
		FastHeapNode current = openHeap.top();
		openHeap.pop();

		size_t currentIndex = static_cast<size_t>(current.index);
		if ( currentIndex >= nodeCount )
			continue;

		if ( current.f != fScore[currentIndex] )
			continue;

		if ( closed[currentIndex] )
			continue;

		if ( currentIndex == goalIndex )
		{
			return BuildPathFromParentsReverse(graph, parent, startIndex, goalIndex, outPath);
		}

		closed[currentIndex] = true;
		AStarGraphNode* currentNode = graph.nodes[currentIndex].get();

#if USE_FSA_MEMORY
		unsigned int i = 0;
		for ( auto edge = begin(currentNode->edges); i < currentNode->numEdges; ++edge, ++i )
#else
		for ( auto edge = begin(currentNode->edges); edge != end(currentNode->edges); ++edge )
#endif
		{
			if ( edge->type & skipEdgeTypes )
				continue;

			AStarGraphNode* endNode = edge->end;
			if ( endNode->type & skipNodeTypes )
				continue;

			if ( !skippedNodeSet.empty() && skippedNodeSet.find(endNode->id) != skippedNodeSet.end() )
				continue;

			auto itNeighbor = graph.nodeIndexById.find(endNode->id);
			if ( itNeighbor == graph.nodeIndexById.end() )
				continue;

			size_t neighborIndex = itNeighbor->second;
			float tentativeG = gScore[currentIndex] + edge->cost;

			if ( tentativeG < gScore[neighborIndex] )
			{
				parent[neighborIndex] = static_cast<int>(currentIndex);
				gScore[neighborIndex] = tentativeG;
				fScore[neighborIndex] = tentativeG + Get3DDistance(endNode->origin, goalNode->origin);

				if ( closed[neighborIndex] )
					closed[neighborIndex] = false;

				openHeap.push({static_cast<int>(neighborIndex), fScore[neighborIndex]});
			}
		}
	}

	return false;
}

static bool PrecomputePathsToNode(
	AStarGraph& graph,
	unsigned int goalId,
	unsigned int skipNodeTypes,
	unsigned int skipEdgeTypes)
{
	auto itGoal = graph.nodeIndexById.find(goalId);
	if ( itGoal == graph.nodeIndexById.end() )
		return false;

	GraphPrecomputeKey key;
	key.goalId = goalId;
	key.skipNodeTypes = skipNodeTypes;
	key.skipEdgeTypes = skipEdgeTypes;
	if ( graph.precomputedPaths.find(key) != graph.precomputedPaths.end() )
		return true;

	const size_t goalIndex = itGoal->second;
	const size_t nodeCount = graph.nodes.size();

	std::vector<std::vector<IncomingEdge>> incoming(nodeCount);
	incoming.reserve(nodeCount);

	for ( size_t fromIndex = 0; fromIndex < nodeCount; ++fromIndex )
	{
		AStarGraphNode* fromNode = graph.nodes[fromIndex].get();

#if USE_FSA_MEMORY
		unsigned int i = 0;
		for ( auto edge = begin(fromNode->edges); i < fromNode->numEdges; ++edge, ++i )
#else
		for ( auto edge = begin(fromNode->edges); edge != end(fromNode->edges); ++edge )
#endif
		{
			auto itTo = graph.nodeIndexById.find(edge->end->id);
			if ( itTo == graph.nodeIndexById.end() )
				continue;

			size_t toIndex = itTo->second;
			incoming[toIndex].push_back({static_cast<int>(fromIndex), edge->cost, edge->type});
		}
	}

	GraphPrecomputeData data;
	data.parentByIndex.assign(nodeCount, -1);
	data.distByIndex.assign(nodeCount, std::numeric_limits<float>::infinity());

	std::priority_queue<FastHeapNode, std::vector<FastHeapNode>, FastHeapCompare> openHeap;
	data.distByIndex[goalIndex] = 0.0f;
	openHeap.push({static_cast<int>(goalIndex), 0.0f});

	while ( !openHeap.empty() )
	{
		FastHeapNode current = openHeap.top();
		openHeap.pop();

		size_t currentIndex = static_cast<size_t>(current.index);
		if ( currentIndex >= nodeCount )
			continue;

		if ( current.f != data.distByIndex[currentIndex] )
			continue;

		AStarGraphNode* currentNode = graph.nodes[currentIndex].get();
		if ( currentNode->type & skipNodeTypes )
			continue;

		for ( const auto& edge : incoming[currentIndex] )
		{
			if ( edge.type & skipEdgeTypes )
				continue;

			size_t fromIndex = static_cast<size_t>(edge.fromIndex);
			float newDist = data.distByIndex[currentIndex] + edge.cost;

			if ( newDist < data.distByIndex[fromIndex] )
			{
				data.distByIndex[fromIndex] = newDist;
				data.parentByIndex[fromIndex] = static_cast<int>(currentIndex);
				openHeap.push({static_cast<int>(fromIndex), newDist});
			}
		}
	}

	graph.precomputedPaths[key] = std::move(data);

	return true;
}

//
// GSC interface
//

extern customStringIndex_t custom_scr_const;

void gsc_graph_create_graph(void)
{
	unsigned int id = 0;
	bool persist = 0;
	int reserveCount = 0;

	// Get next minimal free graph ID
	while ( true )
	{
		bool availableID = true;
		for ( auto graph = begin(AStarGraphs); graph != end(AStarGraphs); ++graph )
		{
			if ( graph->id == id )
			{
				availableID = false;
				break;
			}
		}
		if ( availableID )
			break;

		id++;
	}

	if ( Scr_GetNumParam() > 0 )
		persist = Scr_GetInt(0);

	if ( Scr_GetNumParam() > 1 )
		reserveCount = Scr_GetInt(1);

	AStarGraphs.emplace_back(id, persist);
	if ( reserveCount > 0 )
	{
		AStarGraphs.back().nodes.reserve(static_cast<size_t>(reserveCount));
		AStarGraphs.back().nodeMap.reserve(static_cast<size_t>(reserveCount));
		AStarGraphs.back().nodeIndexById.reserve(static_cast<size_t>(reserveCount));
	}

	stackPushInt(id);
}

void gsc_graph_remove_graph(void)
{
	unsigned int graphId = Scr_GetInt(0);
	AStarGraph* graphPointer = GetGraphById(graphId);
	if ( !graphPointer )
	{
		stackError("gsc_graph_remove_graph() graph %d does not exist", graphId);
		stackPushUndefined();
		return;
	}

	for ( auto graph = begin(AStarGraphs); graph != end(AStarGraphs); )
	{
		if ( &(*graph) == graphPointer )
		{
			AStarGraphs.erase(graph);

			stackPushBool(qtrue);
			return;
		}
	}
}

void gsc_graph_remove_graphs(void)
{
	for ( auto graph = begin(AStarGraphs); graph != end(AStarGraphs); )
		graph = AStarGraphs.erase(graph);

	stackPushBool(qtrue);
}

void gsc_graph_add_node(void)
{
	unsigned int graphId = Scr_GetInt(0);
	AStarGraph* graphPointer = GetGraphById(graphId);
	if ( !graphPointer )
	{
		stackError("gsc_graph_add_node() graph %d does not exist", graphId);
		stackPushUndefined();
		return;
	}
	AStarGraph& graph = *graphPointer;

#if USE_FSA_MEMORY
	if ( graph.nodes.size() >= MAX_NODES )
	{
		stackError("gsc_graph_add_node() graph %d reached max. number of nodes", graphId);
		stackPushUndefined();
		return;
	}
#endif

	vec3_t origin;
	Scr_GetVector(1, origin);
	int type = 0; 
	if ( Scr_GetNumParam() > 2 )
		type = Scr_GetInt(2);

	unsigned int nodeId = 0;
	if ( Scr_GetNumParam() > 3 )
	{
		nodeId = static_cast<unsigned int>(Scr_GetInt(3));
		if ( graph.nodeMap.find(nodeId) != graph.nodeMap.end() )
		{
			stackError("gsc_graph_add_node() node id %d already exists in graph %d", nodeId, graphId);
			stackPushUndefined();
			return;
		}

		if ( nodeId >= graph.nextNodeId )
			graph.nextNodeId = nodeId + 1;
	}
	else
	{
		nodeId = graph.nextNodeId;
		graph.nextNodeId++;
	}

	InvalidatePrecompute(graph);

	std::unique_ptr<AStarGraphNode> newNode(new AStarGraphNode(nodeId, origin, type));
	AStarGraphNode* nodePointer = newNode.get();
	graph.nodes.emplace_back(std::move(newNode));
	graph.nodeMap.emplace(nodeId, nodePointer);
	graph.nodeIndexById.emplace(nodeId, graph.nodes.size() - 1);

	stackPushInt(nodeId);
}

void gsc_graph_get_node_properties(void)
{
	unsigned int graphId = Scr_GetInt(0);
	AStarGraph* graphPointer = GetGraphById(graphId);
	if ( !graphPointer )
	{
		stackError("gsc_graph_get_node_properties() graph %d does not exist", graphId);
		stackPushUndefined();
		return;
	}
	AStarGraph& graph = *graphPointer;

	unsigned int nodeId = Scr_GetInt(1);
	AStarGraphNode* node = graph.GetNodeById(nodeId);
	if ( !node )
	{
		stackError("gsc_graph_get_node_properties() node %d not found in graph %d", nodeId, graphId);
		stackPushUndefined();
		return;
	}

	vec3_t origin;

	VectorCopy(node->origin, origin);

	Scr_MakeArray();
	Scr_AddVector(origin);
	Scr_AddArrayStringIndexed(custom_scr_const.origin);
	Scr_AddInt(node->type);
	Scr_AddArrayStringIndexed(custom_scr_const.type);
}

void gsc_graph_get_node_origin(void)
{
	unsigned int graphId = Scr_GetInt(0);
	AStarGraph* graphPointer = GetGraphById(graphId);
	if ( !graphPointer )
	{
		stackError("gsc_graph_get_node_origin() graph %d does not exist", graphId);
		stackPushUndefined();
		return;
	}
	AStarGraph& graph = *graphPointer;

	unsigned int nodeId = Scr_GetInt(1);
	AStarGraphNode* node = graph.GetNodeById(nodeId);
	if ( !node )
	{
		stackError("gsc_graph_get_node_origin() node %d not found in graph %d", nodeId, graphId);
		stackPushUndefined();
		return;
	}

	stackPushVector(node->origin);
}

void gsc_graph_set_node_origin(void)
{
	unsigned int graphId = Scr_GetInt(0);
	AStarGraph* graphPointer = GetGraphById(graphId);
	if ( !graphPointer )
	{
		stackError("gsc_graph_set_node_origin() graph %d does not exist", graphId);
		stackPushUndefined();
		return;
	}
	AStarGraph& graph = *graphPointer;

	unsigned int nodeId = Scr_GetInt(1);
	AStarGraphNode* node = graph.GetNodeById(nodeId);
	if ( !node )
	{
		stackError("gsc_graph_set_node_origin() node %d not found in graph %d", nodeId, graphId);
		stackPushUndefined();
		return;
	}

	vec3_t origin;
	Scr_GetVector(2, origin);

	VectorCopy(origin, node->origin);

	// Update edge costs for edges connected to this node (incoming and outgoing)
	for ( auto nodeIter = begin(graph.nodes); nodeIter != end(graph.nodes); ++nodeIter )
	{
		AStarGraphNode* currentNode = nodeIter->get();
#if USE_FSA_MEMORY
		unsigned int i = 0;
		for ( auto edge = begin(currentNode->edges); i < currentNode->numEdges; ++edge, ++i )
#else
		for ( auto edge = begin(currentNode->edges); edge != end(currentNode->edges); ++edge )
#endif
		{
			if ( edge->start == node || edge->end == node )
			{
				edge->cost = Get3DDistance(edge->start->origin, edge->end->origin);
			}
		}
	}

	InvalidatePrecompute(graph);
	stackPushBool(qtrue);
}

void gsc_graph_set_node_type(void)
{
	unsigned int graphId = Scr_GetInt(0);
	AStarGraph* graphPointer = GetGraphById(graphId);
	if ( !graphPointer )
	{
		stackError("gsc_graph_set_node_type() graph %d does not exist", graphId);
		stackPushUndefined();
		return;
	}
	AStarGraph& graph = *graphPointer;

	unsigned int nodeId = Scr_GetInt(1);
	AStarGraphNode* node = graph.GetNodeById(nodeId);
	if ( !node )
	{
		stackError("gsc_graph_set_node_type() node %d not found in graph %d", nodeId, graphId);
		stackPushUndefined();
		return;
	}

	int type = Scr_GetInt(2);
	node->type = type;

	InvalidatePrecompute(graph);
	stackPushBool(qtrue);
}

void gsc_graph_get_node_ids_accessible_from(void)
{
	unsigned int graphId = Scr_GetInt(0);
	AStarGraph* graphPointer = GetGraphById(graphId);
	if ( !graphPointer )
	{
		stackError("gsc_graph_get_node_ids_accessible_from() graph %d does not exist", graphId);
		stackPushUndefined();
		return;
	}
	AStarGraph& graph = *graphPointer;

	unsigned int nodeId = Scr_GetInt(1);
	AStarGraphNode* startNode = graph.GetNodeById(nodeId);
	if ( !startNode )
	{
		stackError("gsc_graph_get_node_ids_accessible_from() node %d not found in graph %d", nodeId, graphId);
		stackPushUndefined();
		return;
	}

	Scr_MakeArray();
#if USE_FSA_MEMORY
	unsigned int i = 0;
	for ( auto edge = begin(startNode->edges); i < startNode->numEdges; ++edge, ++i )
#else
	for ( auto edge = begin(startNode->edges); edge != end(startNode->edges); ++edge )
#endif
	{
		stackPushInt(static_cast<int>(edge->end->id));
		stackPushArrayLast();
	}
}

void gsc_graph_get_node_ids_accessible_to(void)
{
	unsigned int graphId = Scr_GetInt(0);
	AStarGraph* graphPointer = GetGraphById(graphId);
	if ( !graphPointer )
	{
		stackError("gsc_graph_get_node_ids_accessible_to() graph %d does not exist", graphId);
		stackPushUndefined();
		return;
	}
	AStarGraph& graph = *graphPointer;

	unsigned int nodeId = Scr_GetInt(1);
	auto itGoal = graph.nodeIndexById.find(nodeId);
	if ( itGoal == graph.nodeIndexById.end() )
	{
		stackError("gsc_graph_get_node_ids_accessible_to() node %d not found in graph %d", nodeId, graphId);
		stackPushUndefined();
		return;
	}

	const size_t nodeCount = graph.nodes.size();
	Scr_MakeArray();
	std::unordered_set<unsigned int> seen;
	for ( size_t fromIndex = 0; fromIndex < nodeCount; ++fromIndex )
	{
		AStarGraphNode* fromNode = graph.nodes[fromIndex].get();
#if USE_FSA_MEMORY
		unsigned int i = 0;
		for ( auto edge = begin(fromNode->edges); i < fromNode->numEdges; ++edge, ++i )
#else
		for ( auto edge = begin(fromNode->edges); edge != end(fromNode->edges); ++edge )
#endif
		{
			if ( edge->end->id != nodeId )
				continue;

			if ( seen.insert(fromNode->id).second )
			{
				stackPushInt(static_cast<int>(fromNode->id));
				stackPushArrayLast();
			}
		}
	}
}

void gsc_graph_get_all_nodes(void)
{
	unsigned int graphId = Scr_GetInt(0);
	AStarGraph* graphPointer = GetGraphById(graphId);
	if ( !graphPointer )
	{
		stackError("gsc_graph_get_all_nodes() graph %d does not exist", graphId);
		stackPushUndefined();
		return;
	}
	AStarGraph& graph = *graphPointer;

	bool useRange = false;
	vec3_t origin = {0.0f, 0.0f, 0.0f};
	float maxSquaredDistance = 0.0f;

	if ( Scr_GetNumParam() > 1 )
	{
		Scr_GetVector(1, origin);
		useRange = true;

		if ( Scr_GetNumParam() > 2 )
			maxSquaredDistance = Scr_GetFloat(2);
		else
			maxSquaredDistance = std::numeric_limits<float>::infinity();
	}

	Scr_MakeArray();
	for ( auto node = begin(graph.nodes); node != end(graph.nodes); ++node )
	{
		AStarGraphNode* currentNode = node->get();
		if ( useRange )
		{
			float distSq = Get3DDistanceSquared(currentNode->origin, origin);
			if ( distSq > maxSquaredDistance )
				continue;
		}

		stackPushInt(static_cast<int>(currentNode->id));
		stackPushArrayLast();
	}
}

void gsc_graph_remove_node(void)
{
	unsigned int graphId = Scr_GetInt(0);
	AStarGraph* graphPointer = GetGraphById(graphId);
	if ( !graphPointer )
	{
		stackError("gsc_graph_remove_node() graph %d does not exist", graphId);
		stackPushUndefined();
		return;
	}
	AStarGraph& graph = *graphPointer;

	unsigned int nodeId = static_cast<unsigned int>(Scr_GetInt(1));
	AStarGraphNode* searchNode = graph.GetNodeById(nodeId);
	if ( searchNode )
	{
		auto itIndex = graph.nodeIndexById.find(nodeId);
		if ( itIndex != graph.nodeIndexById.end() )
		{
			InvalidatePrecompute(graph);

			// Remove edges to node
			for ( auto node = begin(graph.nodes); node != end(graph.nodes); ++node )
			{
				AStarGraphNode* currentNode = node->get();
#if USE_FSA_MEMORY
				unsigned int currentNumEdges = currentNode->numEdges;

				for ( unsigned int i = 0; i < currentNumEdges; i++ )
				{
					if ( currentNode->edges[i].end == searchNode )
					{
						if ( i < ( MAX_EDGES - 1 ) )
						{
							for ( unsigned int j = i; j < MAX_EDGES - 1; j++ )
							{
								currentNode->edges[j].start = currentNode->edges[j + 1].start;
								currentNode->edges[j].end = currentNode->edges[j + 1].end;
								currentNode->edges[j].type = currentNode->edges[j + 1].type;
								currentNode->edges[j].cost = currentNode->edges[j + 1].cost;
							}
						}
						currentNode->numEdges--;
						break; // Assuming a node cannot have multiple edges to another node
					}
				}
#else
				for ( auto edge = begin(currentNode->edges); edge != end(currentNode->edges); )
				{
					if ( edge->end == searchNode )
					{
						edge = currentNode->edges.erase(edge);
						break; // Assuming a node cannot have multiple edges to another node
					}
					else
					{
						++edge;
					}
				}
#endif
			}

			graph.nodeMap.erase(nodeId);
			graph.nodeIndexById.erase(nodeId);

			// Remove node itself using swap-erase
			size_t indexToRemove = itIndex->second;
			if ( indexToRemove < graph.nodes.size() - 1 )
			{
				std::swap(graph.nodes[indexToRemove], graph.nodes.back());
				unsigned int swappedId = graph.nodes[indexToRemove]->id;
				graph.nodeIndexById[swappedId] = indexToRemove;
			}
			graph.nodes.pop_back();

			stackPushBool(qtrue);
			return;
		}
	}

	stackPushBool(qfalse);
}

void gsc_graph_add_edge(void)
{
	unsigned int graphId = Scr_GetInt(0);
	AStarGraph* graphPointer = GetGraphById(graphId);
	if ( !graphPointer )
	{
		stackError("gsc_graph_add_edge() graph %d does not exist", graphId);
		stackPushUndefined();
		return;
	}
	AStarGraph& graph = *graphPointer;

	unsigned int fromNodeId = Scr_GetInt(1);
	AStarGraphNode* fromNode = graph.GetNodeById(fromNodeId);
	if ( !fromNode )
	{
		stackError("gsc_graph_add_edge() start node %d not found in graph %d", fromNodeId, graphId);
		stackPushUndefined();
		return;
	}

#if USE_FSA_MEMORY
	if ( fromNode->numEdges >= MAX_EDGES )
	{
		stackError("gsc_graph_add_edge() node %d reached max. number of edges in graph %d", fromNodeId, graphId);
		stackPushUndefined();
		return;
	}
#endif

	unsigned int toNodeId = Scr_GetInt(2);
	AStarGraphNode* toNode = graph.GetNodeById(toNodeId);
	if ( !toNode )
	{
		stackError("gsc_graph_add_edge() end node %d not found in graph %d", toNodeId, graphId);
		stackPushUndefined();
		return;
	}

	if ( fromNodeId == toNodeId )
	{
		stackError("gsc_graph_add_edge() edge cannot have same start and end");
		stackPushUndefined();
		return;
	}

#if USE_FSA_MEMORY
	for ( unsigned int i = 0; i < fromNode->numEdges; i++ )
	{
		if ( fromNode->edges[i].end == toNode )
#else
	for ( auto edge = begin(fromNode->edges); edge != end(fromNode->edges); ++edge )
	{
		if ( edge->end == toNode )
#endif
		{
			stackError("gsc_graph_add_edge() there already is an edge from node %d to %d in graph %d", fromNodeId, toNodeId, graphId);
			stackPushUndefined();
			return;
		}
	}

	int type = 0;
	if ( Scr_GetNumParam() > 3 )
		type = Scr_GetInt(3);

	float cost;
	if ( Scr_GetNumParam() > 4 )
		cost = Scr_GetFloat(4);
	else
		cost = Get3DDistance(fromNode->origin, toNode->origin);	// Euclidean distance

	InvalidatePrecompute(graph);

#if USE_FSA_MEMORY
	fromNode->edges[fromNode->numEdges].Update(fromNode, toNode, type, cost);
	fromNode->numEdges++;
#else
	fromNode->edges.emplace_back(fromNode, toNode, type, cost);
#endif

	stackPushBool(qtrue);
}

void gsc_graph_get_edge_properties(void)
{
	unsigned int graphId = Scr_GetInt(0);
	AStarGraph* graphPointer = GetGraphById(graphId);
	if ( !graphPointer )
	{
		stackError("gsc_graph_get_edge_properties() graph %d does not exist", graphId);
		stackPushUndefined();
		return;
	}
	AStarGraph& graph = *graphPointer;

	unsigned int fromNodeId = Scr_GetInt(1);
	AStarGraphNode* fromNode = graph.GetNodeById(fromNodeId);
	if ( !fromNode )
	{
		stackError("gsc_graph_get_edge_properties() start node %d not found in graph", fromNodeId);
		stackPushUndefined();
		return;
	}

	unsigned int toNodeId = Scr_GetInt(2);
	AStarGraphNode* toNode = graph.GetNodeById(toNodeId);
	if ( !toNode )
	{
		stackError("gsc_graph_get_edge_properties() end node %d not found in graph", toNodeId);
		stackPushUndefined();
		return;
	}

#if USE_FSA_MEMORY
	unsigned int i = 0;
	for ( auto edge = begin(fromNode->edges); i < fromNode->numEdges; ++edge, ++i )
#else
	for ( auto edge = begin(fromNode->edges); edge != end(fromNode->edges); ++edge )
#endif
	{
		if ( edge->end == toNode )
		{
			Scr_MakeArray();
			Scr_AddInt(fromNodeId);
			Scr_AddArrayStringIndexed(custom_scr_const.start);
			Scr_AddInt(toNodeId);
			Scr_AddArrayStringIndexed(custom_scr_const.end);
			Scr_AddInt(edge->type);
			Scr_AddArrayStringIndexed(custom_scr_const.type);
			Scr_AddFloat(edge->cost);
			Scr_AddArrayStringIndexed(custom_scr_const.cost);
			return;
		}
	}

	stackError("gsc_graph_get_edge_properties() no edge with start node %d and end node %d found in graph %d", toNodeId, fromNodeId, graphId);
	stackPushUndefined();
}

void gsc_graph_set_edge_type(void)
{
	unsigned int graphId = Scr_GetInt(0);
	AStarGraph* graphPointer = GetGraphById(graphId);
	if ( !graphPointer )
	{
		stackError("gsc_graph_set_edge_type() graph %d does not exist", graphId);
		stackPushUndefined();
		return;
	}
	AStarGraph& graph = *graphPointer;

	unsigned int fromNodeId = Scr_GetInt(1);
	AStarGraphNode* fromNode = graph.GetNodeById(fromNodeId);
	if ( !fromNode )
	{
		stackError("gsc_graph_set_edge_type() start node %d not found in graph %d", fromNodeId, graphId);
		stackPushUndefined();
		return;
	}

	unsigned int toNodeId = Scr_GetInt(2);
	AStarGraphNode* toNode = graph.GetNodeById(toNodeId);
	if ( !toNode )
	{
		stackError("gsc_graph_set_edge_type() end node %d not found in graph %d", toNodeId, graphId);
		stackPushUndefined();
		return;
	}

	int type = Scr_GetInt(3);

#if USE_FSA_MEMORY
	unsigned int i = 0;
	for ( auto edge = begin(fromNode->edges); i < fromNode->numEdges; ++edge, ++i )
#else
	for ( auto edge = begin(fromNode->edges); edge != end(fromNode->edges); ++edge )
#endif
	{
		if ( edge->end == toNode )
		{
			edge->type = type;
			InvalidatePrecompute(graph);
			stackPushBool(qtrue);
			return;
		}
	}

	stackPushBool(qfalse);
}

void gsc_graph_get_edge_type(void)
{
	unsigned int graphId = Scr_GetInt(0);
	AStarGraph* graphPointer = GetGraphById(graphId);
	if ( !graphPointer )
	{
		stackError("gsc_graph_get_edge_type() graph %d does not exist", graphId);
		stackPushUndefined();
		return;
	}
	AStarGraph& graph = *graphPointer;

	unsigned int fromNodeId = Scr_GetInt(1);
	AStarGraphNode* fromNode = graph.GetNodeById(fromNodeId);
	if ( !fromNode )
	{
		stackError("gsc_graph_get_edge_type() start node %d not found in graph", fromNodeId);
		stackPushUndefined();
		return;
	}

	unsigned int toNodeId = Scr_GetInt(2);
	AStarGraphNode* toNode = graph.GetNodeById(toNodeId);
	if ( !toNode )
	{
		stackError("gsc_graph_get_edge_type() end node %d not found in graph", toNodeId);
		stackPushUndefined();
		return;
	}

#if USE_FSA_MEMORY
	unsigned int i = 0;
	for ( auto edge = begin(fromNode->edges); i < fromNode->numEdges; ++edge, ++i )
#else
	for ( auto edge = begin(fromNode->edges); edge != end(fromNode->edges); ++edge )
#endif
	{
		if ( edge->end == toNode )
		{
			stackPushInt(edge->type);
			return;
		}
	}

	stackError("gsc_graph_get_edge_type() no edge with start node %d and end node %d found in graph %d", toNodeId, fromNodeId, graphId);
	stackPushUndefined();
}

void gsc_graph_remove_edge(void)
{
	unsigned int graphId = Scr_GetInt(0);
	AStarGraph* graphPointer = GetGraphById(graphId);
	if ( !graphPointer )
	{
		stackError("gsc_graph_remove_edge() graph %d does not exist", graphId);
		stackPushUndefined();
		return;
	}
	AStarGraph& graph = *graphPointer;

	unsigned int fromNodeId = Scr_GetInt(1);
	AStarGraphNode* fromNode = graph.GetNodeById(fromNodeId);
	if ( !fromNode )
	{
		stackError("gsc_graph_remove_edge() start node %d not found in graph %d", fromNodeId, graphId);
		stackPushUndefined();
		return;
	}

#if USE_FSA_MEMORY
	if ( fromNode->numEdges < 1 )
	{
		stackError("gsc_graph_remove_edge() start node %d has no edges in graph %d", fromNodeId, graphId);
		stackPushUndefined();
		return;
	}
#endif

	unsigned int toNodeId = Scr_GetInt(2);
	AStarGraphNode* toNode = graph.GetNodeById(toNodeId);
	if ( !toNode )
	{
		stackError("gsc_graph_remove_edge() end node %d not found in graph %d", toNodeId, graphId);
		stackPushUndefined();
		return;
	}

#if USE_FSA_MEMORY
	unsigned int currentNumEdges = fromNode->numEdges;

	for ( unsigned int i = 0; i < currentNumEdges; i++ )
	{
		if ( fromNode->edges[i].end == toNode )
		{
			if ( i < ( MAX_EDGES - 1 ) )
			{
				for ( unsigned int j = i; j < MAX_EDGES - 1; j++ )
				{
					fromNode->edges[j].start = fromNode->edges[j + 1].start;
					fromNode->edges[j].end = fromNode->edges[j + 1].end;
					fromNode->edges[j].type = fromNode->edges[j + 1].type;
					fromNode->edges[j].cost = fromNode->edges[j + 1].cost;
				}
			}
			fromNode->numEdges--;

			InvalidatePrecompute(graph);
			stackPushBool(qtrue);
			return;
		}
	}
#else
	for ( auto edge = begin(fromNode->edges); edge != end(fromNode->edges); )
	{
		if ( edge->end == toNode )
		{
			fromNode->edges.erase(edge);

			InvalidatePrecompute(graph);
			stackPushBool(qtrue);
			return;
		}
		else
		{
			++edge;
		}
	}
#endif

	stackPushBool(qfalse);
}

void gsc_graph_find_path_astar(void)
{
	unsigned int graphId = Scr_GetInt(0);
	AStarGraph* graphPointer = GetGraphById(graphId);
	if ( !graphPointer )
	{
		stackError("gsc_graph_find_path_astar() graph %d does not exist", graphId);
		stackPushUndefined();
		return;
	}
	AStarGraph& graph = *graphPointer;

	if ( graph.nodes.size() < 2 )
	{
		stackError("gsc_graph_find_path_astar() graph %d has less than two nodes", graphId);
		stackPushUndefined();
		return;
	}

	unsigned int start = Scr_GetInt(1);
	unsigned int end = Scr_GetInt(2);
	if ( !graph.GetNodeById(start) )
	{
		stackError("gsc_graph_find_path_astar() start node %d not found in graph %d", start, graphId);
		stackPushUndefined();
		return;
	}
	if ( !graph.GetNodeById(end) )
	{
		stackError("gsc_graph_find_path_astar() end node %d not found in graph %d", end, graphId);
		stackPushUndefined();
		return;
	}

	vector<unsigned int>skipNodes;
	if ( Scr_GetNumParam() > 3 )
	{
		if ( Scr_GetType(3) == VAR_OBJECT && Scr_GetPointerType(3) == VAR_ARRAY )
		{
			unsigned int arrIndex;
			VariableValue *var;

			var = &scrVmPub.top[-3];
			arrIndex = var->u.pointerValue;

			unsigned int arraysize = GetArraySize(arrIndex);
			if ( arraysize )
			{
				unsigned int index = arrIndex;
				VariableValueInternal_u *value;
				unsigned int skip;
	
				for ( unsigned int i = 0; i < arraysize; i++ )
				{
					index = FindNextSibling(index);
					value = GetVariableValueAddress(index);
	
					if ( GetVarType(index) != VAR_INTEGER )
					{
						stackError("gsc_graph_find_path_astar() element %d of skip node array is type %s, not integer", i, getParamTypeAsString(index));
						stackPushUndefined();
						return;
					}
	
					skip = value->u.intValue;
					if ( skip == start || skip == end )
					{
						stackError("gsc_graph_find_path_astar() cannot skip start node %d or end node %d", start, end);
						stackPushUndefined();
						return;
					}
					skipNodes.push_back(skip);
				}
			}
		}
		else
		{
			stackError("gsc_graph_find_path_astar() skip nodes must be an array of node IDs");
			stackPushUndefined();
			return;
		}
	}

	unsigned int skipNodeTypes = 0;
	if ( Scr_GetNumParam() > 4 )
	{
		skipNodeTypes = Scr_GetInt(4);
	}

	unsigned int skipEdgeTypes = 0;
	if ( Scr_GetNumParam() > 5 )
	{
		skipEdgeTypes = Scr_GetInt(5);
	}

	std::vector<unsigned int> path;
	bool success = false;

	if ( skipNodes.empty() )
	{
		GraphPrecomputeKey key;
		key.goalId = end;
		key.skipNodeTypes = skipNodeTypes;
		key.skipEdgeTypes = skipEdgeTypes;

		auto itPre = graph.precomputedPaths.find(key);
		if ( itPre != graph.precomputedPaths.end() )
		{
			auto itStart = graph.nodeIndexById.find(start);
			auto itGoal = graph.nodeIndexById.find(end);
			if ( itStart != graph.nodeIndexById.end() && itGoal != graph.nodeIndexById.end() )
			{
				success = BuildPathFromParents(
					graph,
					itPre->second.parentByIndex,
					itStart->second,
					itGoal->second,
					path);
			}
		}
	}

	if ( !success )
	{
		success = FindPathAStarFast(graph, start, end, skipNodes, skipNodeTypes, skipEdgeTypes, path);
	}

	if ( success )
	{
		if ( path.empty() || path.front() != start )
			path.insert(path.begin(), start);

		stackPushArray();
		for ( auto nodeId : path )
		{
			stackPushInt(static_cast<int>(nodeId));
			stackPushArrayLast();
		}
	}
	else
	{
		stackPushUndefined();
	}
}

void gsc_graph_precompute_paths_to_node(void)
{
	unsigned int graphId = Scr_GetInt(0);
	AStarGraph* graphPointer = GetGraphById(graphId);
	if ( !graphPointer )
	{
		stackError("gsc_graph_precompute_paths_to_node() graph %d does not exist", graphId);
		stackPushUndefined();
		return;
	}
	AStarGraph& graph = *graphPointer;

	if ( graph.nodes.size() < 1 )
	{
		stackError("gsc_graph_precompute_paths_to_node() graph %d has no nodes", graphId);
		stackPushUndefined();
		return;
	}

	unsigned int goalId = Scr_GetInt(1);
	if ( !graph.GetNodeById(goalId) )
	{
		stackError("gsc_graph_precompute_paths_to_node() goal node %d not found in graph %d", goalId, graphId);
		stackPushUndefined();
		return;
	}

	unsigned int skipNodeTypes = 0;
	if ( Scr_GetNumParam() > 2 )
	{
		skipNodeTypes = Scr_GetInt(2);
	}

	unsigned int skipEdgeTypes = 0;
	if ( Scr_GetNumParam() > 3 )
	{
		skipEdgeTypes = Scr_GetInt(3);
	}

	if ( !PrecomputePathsToNode(graph, goalId, skipNodeTypes, skipEdgeTypes) )
	{
		stackError("gsc_graph_precompute_paths_to_node() failed to precompute paths to node %d in graph %d", goalId, graphId);
		stackPushUndefined();
		return;
	}

	stackPushBool(qtrue);
}

void gsc_graph_find_closest_node(void)
{
	int args = Scr_GetNumParam();
	unsigned int graphId = Scr_GetInt(0);
	AStarGraph* graphPointer = GetGraphById(graphId);
	if ( !graphPointer )
	{
		stackError("gsc_graph_find_closest_node() graph %d does not exist", graphId);
		stackPushUndefined();
		return;
	}
	AStarGraph& graph = *graphPointer;

	if ( graph.nodes.size() < 1 )
	{
		stackError("gsc_graph_find_closest_node() graph %d has no nodes", graphId);
		stackPushUndefined();
		return;
	}

	vec3_t origin;
	float dist;
	float closestDist = numeric_limits<float>::infinity();
	unsigned int closestNodeId = 0;
	bool foundNode = false;
	bool useContentMask = false;
	int contentMask = 0;

	Scr_GetVector(1, origin);
	if ( args > 2 )
	{
		useContentMask = true;
		contentMask = Scr_GetInt(2);
	}

	for ( auto node = begin(graph.nodes); node != end(graph.nodes); ++node )
	{
		AStarGraphNode* currentNode = node->get();

		if ( useContentMask && !G_LocationalTracePassed(currentNode->origin, origin, ENTITYNUM_NONE, contentMask) )
			continue;

		dist = Get3DDistanceSquared(currentNode->origin, origin);
		if ( dist < closestDist )
		{
			closestDist = dist;
			closestNodeId = currentNode->id;
			foundNode = true;
		}
	}

	if ( !foundNode )
	{
		stackPushUndefined();
		return;
	}

	Scr_AddInt(closestNodeId);
}

void gsc_graph_find_closest_edge(void)
{
	unsigned int graphId = Scr_GetInt(0);
	AStarGraph* graphPointer = GetGraphById(graphId);
	if ( !graphPointer )
	{
		stackError("gsc_graph_find_closest_edge() graph %d does not exist", graphId);
		stackPushUndefined();
		return;
	}
	AStarGraph& graph = *graphPointer;

	if ( graph.nodes.size() < 2 )
	{
		stackError("gsc_graph_find_closest_edge() graph %d has less than two nodes", graphId);
		stackPushUndefined();
		return;
	}

	vec3_t origin;
	AStarGraphNode* currentNode;
	AStarGraphEdge* currentEdge;
	vec3_t o;
	float dist;
	float closestEdgeDist = numeric_limits<float>::infinity();
	vec3_t closestPoint;
	AStarGraphEdge* closestEdge = NULL;

	Scr_GetVector(1, origin);

	// Get closest point on each edge, return closest. We do not search the
	// closest node first, as it may have zero edges
	for ( auto node = begin(graph.nodes); node != end(graph.nodes); ++node )
	{
		currentNode = node->get();

#if USE_FSA_MEMORY
		unsigned int i = 0;
		for ( auto edge = begin(currentNode->edges); i < currentNode->numEdges; ++edge, ++i )
#else
		for ( auto edge = begin(currentNode->edges); edge != end(currentNode->edges); ++edge )
#endif
		{
			currentEdge = &(*edge);
			ProjectPointOnLine(currentEdge->start->origin, currentEdge->end->origin, origin, o);
			dist = Get3DDistanceSquared(o, origin);
			if ( dist < closestEdgeDist )
			{
				closestEdgeDist = dist;
				VectorCopy(o, closestPoint);
				closestEdge = &(*edge);
			}
		}
	}

	if ( closestEdge == NULL )
	{
		stackError("gsc_graph_find_closest_edge() graph %d has no edges", graphId);
		stackPushUndefined();
		return;
	}

	Scr_MakeArray();
	Scr_AddInt(closestEdge->start->id);
	Scr_AddArrayStringIndexed(custom_scr_const.start);
	Scr_AddInt(closestEdge->end->id);
	Scr_AddArrayStringIndexed(custom_scr_const.end);
	Scr_AddVector(closestPoint);
	Scr_AddArrayStringIndexed(custom_scr_const.origin);
	Scr_AddFloat(closestEdge->cost);
	Scr_AddArrayStringIndexed(custom_scr_const.cost);
	Scr_AddInt(closestEdge->type);
	Scr_AddArrayStringIndexed(custom_scr_const.type);
}

struct AutoNodeCandidate
{
	vec3_t origin = {0.0f, 0.0f, 0.0f};
	unsigned int nodeId = 0;
	unsigned int capabilityMask = 0;
};

static bool TraceFloorAtXY(
	float x,
	float y,
	float startZ,
	float endZ,
	int contentMask,
	float& outFloorZ,
	float outNormal[3])
{
	trace_t trace;
	vec3_t start = {x, y, startZ};
	vec3_t end = {x, y, endZ};
	vec3_t mins = {0.0f, 0.0f, 0.0f};
	vec3_t maxs = {0.0f, 0.0f, 0.0f};
	SV_Trace(&trace, start, mins, maxs, end, ENTITYNUM_NONE, contentMask, 0, NULL, 0);

	if ( trace.fraction >= 1.0f )
		return false;

	vec3_t hit;
	Vec3Lerp(start, end, trace.fraction, hit);
	outFloorZ = hit[2];
	outNormal[0] = trace.normal[0];
	outNormal[1] = trace.normal[1];
	outNormal[2] = trace.normal[2];
	return true;
}

static bool IsPointClearToHeight(const vec3_t floorPoint, float height, int contentMask)
{
	trace_t trace;
	vec3_t start = {floorPoint[0], floorPoint[1], floorPoint[2] + 2.0f};
	vec3_t end = {floorPoint[0], floorPoint[1], floorPoint[2] + height};
	vec3_t mins = {0.0f, 0.0f, 0.0f};
	vec3_t maxs = {0.0f, 0.0f, 0.0f};
	SV_Trace(&trace, start, mins, maxs, end, ENTITYNUM_NONE, contentMask, 0, NULL, 0);
	return trace.fraction >= 1.0f;
}

static bool HasWallClearance(const vec3_t floorPoint, float minWallClearance, int contentMask)
{
	if ( minWallClearance <= 0.0f )
		return true;

	static const float dirs[8][2] = {
		{1.0f, 0.0f}, {-1.0f, 0.0f}, {0.0f, 1.0f}, {0.0f, -1.0f},
		{0.7071f, 0.7071f}, {0.7071f, -0.7071f}, {-0.7071f, 0.7071f}, {-0.7071f, -0.7071f}
	};

	for ( unsigned int i = 0; i < 8; ++i )
	{
		trace_t trace;
		vec3_t start = {floorPoint[0], floorPoint[1], floorPoint[2] + 2.0f};
		vec3_t end = {
			floorPoint[0] + dirs[i][0] * minWallClearance,
			floorPoint[1] + dirs[i][1] * minWallClearance,
			floorPoint[2] + 2.0f
		};
		vec3_t mins = {0.0f, 0.0f, 0.0f};
		vec3_t maxs = {0.0f, 0.0f, 0.0f};
		SV_Trace(&trace, start, mins, maxs, end, ENTITYNUM_NONE, contentMask, 0, NULL, 0);
		if ( trace.fraction < 1.0f )
			return false;
	}

	return true;
}

static int DetermineEdgeType(
	const AutoNodeCandidate& from,
	const AutoNodeCandidate& to,
	float normalHeight,
	float crouchHeight,
	float proneHeight,
	int edgeTypeNormal,
	int edgeTypeCrouch,
	int edgeTypeProne,
	int edgeTypeLadder,
	int edgeTypeMantle,
	int edgeTypeJump,
	float maxJumpHeight,
	int contentMask)
{
	vec3_t mins = {-8.0f, -8.0f, 0.0f};
	vec3_t maxsNormal = {8.0f, 8.0f, normalHeight};
	vec3_t maxsCrouch = {8.0f, 8.0f, crouchHeight};
	vec3_t maxsProne = {8.0f, 8.0f, proneHeight};
	trace_t trace;

	vec3_t start = {from.origin[0], from.origin[1], from.origin[2] + 2.0f};
	vec3_t end = {to.origin[0], to.origin[1], to.origin[2] + 2.0f};
	float zDelta = to.origin[2] - from.origin[2];

	if ( edgeTypeLadder != INT_MIN || edgeTypeMantle != INT_MIN )
	{
		vec3_t wallStart = {from.origin[0], from.origin[1], from.origin[2] + 24.0f};
		vec3_t wallEnd = {to.origin[0], to.origin[1], to.origin[2] + 24.0f};
		vec3_t pointMins = {0.0f, 0.0f, 0.0f};
		vec3_t pointMaxs = {0.0f, 0.0f, 0.0f};
		SV_Trace(&trace, wallStart, pointMins, pointMaxs, wallEnd, ENTITYNUM_NONE, contentMask, 0, NULL, 0);

		if ( trace.fraction < 1.0f )
		{
			if ( edgeTypeLadder != INT_MIN && ( trace.surfaceFlags & SURF_LADDER ) )
				return edgeTypeLadder;

			if ( edgeTypeMantle != INT_MIN && ( trace.surfaceFlags & ( SURF_MANTLEON | SURF_MANTLEOVER ) ) )
				return edgeTypeMantle;
		}
	}

	if ( ( from.capabilityMask & 1 ) && ( to.capabilityMask & 1 ) )
	{
		SV_Trace(&trace, start, mins, maxsNormal, end, ENTITYNUM_NONE, contentMask, 0, NULL, 0);
		if ( trace.fraction >= 1.0f )
			return edgeTypeNormal;
	}

	if ( ( from.capabilityMask & 2 ) && ( to.capabilityMask & 2 ) )
	{
		SV_Trace(&trace, start, mins, maxsCrouch, end, ENTITYNUM_NONE, contentMask, 0, NULL, 0);
		if ( trace.fraction >= 1.0f )
			return edgeTypeCrouch;
	}

	if ( ( from.capabilityMask & 4 ) && ( to.capabilityMask & 4 ) )
	{
		SV_Trace(&trace, start, mins, maxsProne, end, ENTITYNUM_NONE, contentMask, 0, NULL, 0);
		if ( trace.fraction >= 1.0f )
			return edgeTypeProne;
	}

	if ( edgeTypeJump != INT_MIN && zDelta <= maxJumpHeight )
	{
		vec3_t mid = {
			(from.origin[0] + to.origin[0]) * 0.5f,
			(from.origin[1] + to.origin[1]) * 0.5f,
			(from.origin[2] + to.origin[2]) * 0.5f
		};
		float dropDistance = std::max(64.0f, fabsf(zDelta) + 32.0f);
		vec3_t downStart = {mid[0], mid[1], mid[2] + 8.0f};
		vec3_t downEnd = {mid[0], mid[1], mid[2] - dropDistance};
		vec3_t pointMins = {0.0f, 0.0f, 0.0f};
		vec3_t pointMaxs = {0.0f, 0.0f, 0.0f};
		SV_Trace(&trace, downStart, pointMins, pointMaxs, downEnd, ENTITYNUM_NONE, contentMask, 0, NULL, 0);

		bool hasGap = trace.fraction >= 1.0f;
		if ( hasGap )
			return edgeTypeJump;
	}

	return INT_MIN;
}

void gsc_graph_get_all_edges(void)
{
	unsigned int graphId = Scr_GetInt(0);
	AStarGraph* graphPointer = GetGraphById(graphId);
	if ( !graphPointer )
	{
		stackError("gsc_graph_get_all_edges() graph %d does not exist", graphId);
		stackPushUndefined();
		return;
	}
	AStarGraph& graph = *graphPointer;

	Scr_MakeArray();
	for ( auto node = begin(graph.nodes); node != end(graph.nodes); ++node )
	{
		AStarGraphNode* currentNode = node->get();
#if USE_FSA_MEMORY
		unsigned int i = 0;
		for ( auto edge = begin(currentNode->edges); i < currentNode->numEdges; ++edge, ++i )
#else
		for ( auto edge = begin(currentNode->edges); edge != end(currentNode->edges); ++edge )
#endif
		{
			Scr_MakeArray();
			Scr_AddInt(currentNode->id);
			Scr_AddArrayStringIndexed(custom_scr_const.start);
			Scr_AddInt(edge->end->id);
			Scr_AddArrayStringIndexed(custom_scr_const.end);
			Scr_AddFloat(edge->cost);
			Scr_AddArrayStringIndexed(custom_scr_const.cost);
			Scr_AddInt(edge->type);
			Scr_AddArrayStringIndexed(custom_scr_const.type);
			Scr_AddArray();
		}
	}
}

void gsc_graph_autodiscover(void)
{
	if ( Scr_GetNumParam() < 14 )
	{
		stackError("gsc_graph_autodiscover() requires 14 params: graphId, origin, mins, maxs, sampleSpacing, edgeLinkRadius, minWallClearance, maxStepHeight, normalHeight, crouchHeight, proneHeight, edgeTypeNormal, edgeTypeCrouch, edgeTypeProne (optional: edgeTypeLadder, edgeTypeMantle, edgeTypeJump, maxJumpHeight)");
		stackPushUndefined();
		return;
	}

	unsigned int graphId = static_cast<unsigned int>(Scr_GetInt(0));
	AStarGraph* graphPointer = GetGraphById(graphId);
	if ( !graphPointer )
	{
		stackError("gsc_graph_autodiscover() graph %d does not exist", graphId);
		stackPushUndefined();
		return;
	}
	AStarGraph& graph = *graphPointer;

	vec3_t discoverOrigin;
	vec3_t areaMins;
	vec3_t areaMaxs;
	Scr_GetVector(1, discoverOrigin);
	Scr_GetVector(2, areaMins);
	Scr_GetVector(3, areaMaxs);
	float sampleSpacing = Scr_GetFloat(4);
	float edgeLinkRadius = Scr_GetFloat(5);
	float minWallClearance = Scr_GetFloat(6);
	float maxStepHeight = Scr_GetFloat(7);
	float normalHeight = Scr_GetFloat(8);
	float crouchHeight = Scr_GetFloat(9);
	float proneHeight = Scr_GetFloat(10);
	int edgeTypeNormal = Scr_GetInt(11);
	int edgeTypeCrouch = Scr_GetInt(12);
	int edgeTypeProne = Scr_GetInt(13);
	int edgeTypeLadder = Scr_GetNumParam() > 14 ? Scr_GetInt(14) : INT_MIN;
	int edgeTypeMantle = Scr_GetNumParam() > 15 ? Scr_GetInt(15) : INT_MIN;
	int edgeTypeJump = Scr_GetNumParam() > 16 ? Scr_GetInt(16) : INT_MIN;
	float maxJumpHeight = Scr_GetNumParam() > 17 ? Scr_GetFloat(17) : maxStepHeight;

	if ( sampleSpacing <= 1.0f || edgeLinkRadius <= 1.0f || normalHeight <= 1.0f || crouchHeight <= 1.0f || proneHeight <= 1.0f || maxJumpHeight < maxStepHeight )
	{
		stackError("gsc_graph_autodiscover() invalid numeric parameters");
		stackPushUndefined();
		return;
	}

	if ( areaMins[0] > areaMaxs[0] || areaMins[1] > areaMaxs[1] || areaMins[2] > areaMaxs[2] )
	{
		stackError("gsc_graph_autodiscover() invalid bounding box mins/maxs");
		stackPushUndefined();
		return;
	}

	const int contentMask = MASK_SOLID;
	const float maxSlopeNormalZ = 0.5f;
	const float maxLayerSearchDown = 4096.0f;
	const float minVerticalLayerSeparation = std::max(18.0f, maxStepHeight + 1.0f);
	const int maxLayersPerColumn = 6;

	std::vector<AutoNodeCandidate> generated;
	generated.reserve(2048);

	for ( float x = areaMins[0]; x <= areaMaxs[0]; x += sampleSpacing )
	{
		for ( float y = areaMins[1]; y <= areaMaxs[1]; y += sampleSpacing )
		{
			float startZ = areaMaxs[2] + 32.0f;
			for ( int layer = 0; layer < maxLayersPerColumn; ++layer )
			{
				float floorZ;
				float floorNormal[3] = {0.0f, 0.0f, 0.0f};
				if ( !TraceFloorAtXY(x, y, startZ, areaMins[2] - maxLayerSearchDown, contentMask, floorZ, floorNormal) )
					break;

				if ( floorNormal[2] < maxSlopeNormalZ )
				{
					startZ = floorZ - minVerticalLayerSeparation;
					continue;
				}

				vec3_t floorPoint = {x, y, floorZ};
				unsigned int capabilityMask = 0;
				if ( IsPointClearToHeight(floorPoint, normalHeight, contentMask) )
					capabilityMask |= 1;
				if ( IsPointClearToHeight(floorPoint, crouchHeight, contentMask) )
					capabilityMask |= 2;
				if ( IsPointClearToHeight(floorPoint, proneHeight, contentMask) )
					capabilityMask |= 4;

				if ( capabilityMask != 0 && HasWallClearance(floorPoint, minWallClearance, contentMask) )
				{
					AutoNodeCandidate candidate;
					candidate.origin[0] = x;
					candidate.origin[1] = y;
					candidate.origin[2] = floorZ;
					candidate.capabilityMask = capabilityMask;
					generated.push_back(candidate);
				}

				startZ = floorZ - minVerticalLayerSeparation;
				if ( startZ <= areaMins[2] - maxLayerSearchDown )
					break;
			}
		}
	}

	if ( generated.empty() )
	{
		stackPushInt(0);
		return;
	}

	for ( auto& candidate : generated )
	{
		unsigned int nodeId = graph.nextNodeId;
		graph.nextNodeId++;
		std::unique_ptr<AStarGraphNode> newNode(new AStarGraphNode(nodeId, candidate.origin, 0));
		AStarGraphNode* nodePointer = newNode.get();
		graph.nodes.emplace_back(std::move(newNode));
		graph.nodeMap.emplace(nodeId, nodePointer);
		graph.nodeIndexById.emplace(nodeId, graph.nodes.size() - 1);
		candidate.nodeId = nodeId;
	}

	const float maxLinkDistSq = edgeLinkRadius * edgeLinkRadius;
	for ( size_t i = 0; i < generated.size(); ++i )
	{
		AStarGraphNode* fromNode = graph.GetNodeById(generated[i].nodeId);
		if ( !fromNode )
			continue;

		for ( size_t j = 0; j < generated.size(); ++j )
		{
			if ( i == j )
				continue;

			float distSq = Get3DDistanceSquared(generated[i].origin, generated[j].origin);
			if ( distSq > maxLinkDistSq )
				continue;

			if ( fabsf(generated[i].origin[2] - generated[j].origin[2]) > maxJumpHeight )
				continue;

			bool duplicate = false;
#if USE_FSA_MEMORY
			for ( unsigned int e = 0; e < fromNode->numEdges; ++e )
			{
				if ( fromNode->edges[e].end->id == generated[j].nodeId )
				{
					duplicate = true;
					break;
				}
			}
#else
			for ( auto edge = begin(fromNode->edges); edge != end(fromNode->edges); ++edge )
			{
				if ( edge->end->id == generated[j].nodeId )
				{
					duplicate = true;
					break;
				}
			}
#endif
			if ( duplicate )
				continue;

			int edgeType = DetermineEdgeType(
				generated[i],
				generated[j],
				normalHeight,
				crouchHeight,
				proneHeight,
				edgeTypeNormal,
				edgeTypeCrouch,
				edgeTypeProne,
				edgeTypeLadder,
				edgeTypeMantle,
				edgeTypeJump,
				maxJumpHeight,
				contentMask);
			if ( edgeType == INT_MIN )
				continue;

			AStarGraphNode* toNode = graph.GetNodeById(generated[j].nodeId);
			if ( !toNode )
				continue;

#if USE_FSA_MEMORY
			if ( fromNode->numEdges >= MAX_EDGES )
				continue;
			fromNode->edges[fromNode->numEdges].Update(fromNode, toNode, edgeType, sqrtf(distSq));
			fromNode->numEdges++;
#else
			fromNode->edges.emplace_back(fromNode, toNode, edgeType, sqrtf(distSq));
#endif
		}
	}

	if ( !graph.nodes.empty() )
	{
		unsigned int seedNodeId = generated.front().nodeId;
		float closestDist = std::numeric_limits<float>::infinity();
		for ( const auto& c : generated )
		{
			float d = Get3DDistanceSquared(const_cast<float*>(c.origin), discoverOrigin);
			if ( d < closestDist )
			{
				closestDist = d;
				seedNodeId = c.nodeId;
			}
		}

		std::unordered_set<unsigned int> visited;
		std::queue<unsigned int> q;
		visited.insert(seedNodeId);
		q.push(seedNodeId);

		while ( !q.empty() )
		{
			unsigned int id = q.front();
			q.pop();
			AStarGraphNode* node = graph.GetNodeById(id);
			if ( !node )
				continue;

#if USE_FSA_MEMORY
			for ( unsigned int e = 0; e < node->numEdges; ++e )
			{
				unsigned int nid = node->edges[e].end->id;
				if ( visited.insert(nid).second )
					q.push(nid);
			}
#else
			for ( auto edge = begin(node->edges); edge != end(node->edges); ++edge )
			{
				unsigned int nid = edge->end->id;
				if ( visited.insert(nid).second )
					q.push(nid);
			}
#endif
		}

		std::vector<unsigned int> removeIds;
		removeIds.reserve(generated.size());
		for ( const auto& c : generated )
		{
			if ( visited.find(c.nodeId) == visited.end() )
				removeIds.push_back(c.nodeId);
		}

		for ( auto id : removeIds )
		{
			AStarGraphNode* searchNode = graph.GetNodeById(id);
			if ( !searchNode )
				continue;

			for ( auto node = begin(graph.nodes); node != end(graph.nodes); ++node )
			{
				AStarGraphNode* currentNode = node->get();
#if USE_FSA_MEMORY
				unsigned int currentNumEdges = currentNode->numEdges;
				for ( unsigned int i = 0; i < currentNumEdges; ++i )
				{
					if ( currentNode->edges[i].end == searchNode )
					{
						for ( unsigned int j = i; j + 1 < currentNode->numEdges; ++j )
							currentNode->edges[j] = currentNode->edges[j + 1];
						currentNode->numEdges--;
						break;
					}
				}
#else
				for ( auto edge = begin(currentNode->edges); edge != end(currentNode->edges); )
				{
					if ( edge->end == searchNode )
						edge = currentNode->edges.erase(edge);
					else
						++edge;
				}
#endif
			}

			auto itIndex = graph.nodeIndexById.find(id);
			if ( itIndex == graph.nodeIndexById.end() )
				continue;
			size_t indexToRemove = itIndex->second;
			graph.nodeMap.erase(id);
			graph.nodeIndexById.erase(id);
			if ( indexToRemove < graph.nodes.size() - 1 )
			{
				std::swap(graph.nodes[indexToRemove], graph.nodes.back());
				unsigned int swappedId = graph.nodes[indexToRemove]->id;
				graph.nodeIndexById[swappedId] = indexToRemove;
			}
			graph.nodes.pop_back();
		}
	}

	InvalidatePrecompute(graph);
	stackPushInt(static_cast<int>(graph.nodes.size()));
}
