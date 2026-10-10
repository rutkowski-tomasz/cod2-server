#include "nl.hpp"
#include <deque>
#include <string>

// A server that never takes the messages keeps only the latest ones.
#define MAX_PRINTED_MESSAGES 256

struct PrintedMessage
{
	int client;
	bool bold;
	std::string text;
};

static std::deque<PrintedMessage> printedMessages;

// iPrintln sends the command `f "<text>"`, iPrintlnBold `g "<text>"`.
void RecordPrintedMessage(client_t *cl, const char *command)
{
	if ( ( command[0] != 'f' && command[0] != 'g' ) || command[1] != ' ' || command[2] != '"' )
		return;

	size_t length = strlen(command);
	if ( length < 4 || command[length - 1] != '"' )
		return;

	if ( printedMessages.size() == MAX_PRINTED_MESSAGES )
		printedMessages.pop_front();

	printedMessages.push_back({ cl ? (int)(cl - svs.clients) : -1, command[0] == 'g', std::string(command + 3, length - 4) });
}

static void addArrayKey(const char *key)
{
	unsigned int k = SL_GetString(key, 0);
	Scr_AddArrayStringIndexed(k);
	SL_RemoveRefToString(k);
}

void gsc_prints_takeprintedmessages()
{
	stackPushArray();
	for ( const PrintedMessage &message : printedMessages )
	{
		stackPushArray();
		if ( message.client >= 0 )
		{
			stackPushInt(message.client);
			addArrayKey("client");
		}
		stackPushInt(message.bold);
		addArrayKey("bold");
		stackPushString(message.text.c_str());
		addArrayKey("text");
		stackPushArrayLast();
	}
	printedMessages.clear();
}
