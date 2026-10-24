// The action catalog, published to the `meta` table as JSON tool schemas.
// The harness hands these to models unchanged; `applyAction` validates
// whatever comes back. Add an action here and in actions.ts together.

const ITEM = { type: 'string', enum: ['berries', 'ration', 'wood', 'meat', 'medkit', 'flare', 'spear', 'flaming_spear'] };
const QTY = { type: 'integer', minimum: 1, description: 'How many (default 1)' };

export const TOOLS = [
  {
    name: 'move_to',
    description: 'Walk to a point on the map. You keep walking until you arrive or choose another action.',
    parameters: {
      type: 'object',
      properties: { x: { type: 'number', description: 'Tile x' }, y: { type: 'number', description: 'Tile y' } },
      required: ['x', 'y'],
    },
  },
  {
    name: 'explore',
    description: "Walk into part of the forest you haven't seen yet. The world picks the direction.",
    parameters: { type: 'object', properties: {} },
  },
  {
    name: 'follow',
    description: 'Keep walking behind another survivor until you choose another action.',
    parameters: {
      type: 'object',
      properties: { agent_id: { type: 'integer', description: 'id of the survivor to follow' } },
      required: ['agent_id'],
    },
  },
  {
    name: 'gather',
    description:
      'Walk to a berry bush or tree and keep picking berries or chopping wood until it is empty or your hands are full.',
    parameters: {
      type: 'object',
      properties: { node_id: { type: 'integer', description: 'id of the bush or tree' } },
      required: ['node_id'],
    },
  },
  {
    name: 'eat',
    description: 'Eat one berry, ration or piece of meat you are carrying.',
    parameters: {
      type: 'object',
      properties: { item: { type: 'string', enum: ['berries', 'ration', 'meat'] } },
      required: ['item'],
    },
  },
  {
    name: 'take',
    description: 'Take items out of a container (a chest, the plane wreck, or dropped things). If it is out of reach you walk to it first, then take.',
    parameters: {
      type: 'object',
      properties: { container_id: { type: 'integer' }, item: ITEM, qty: QTY },
      required: ['container_id', 'item'],
    },
  },
  {
    name: 'store',
    description: 'Put items you are carrying into a container. If it is out of reach you walk to it first.',
    parameters: {
      type: 'object',
      properties: { container_id: { type: 'integer' }, item: ITEM, qty: QTY },
      required: ['container_id', 'item'],
    },
  },
  {
    name: 'give',
    description: 'Hand items you are carrying to another survivor. If they are out of reach you walk up to them first.',
    parameters: {
      type: 'object',
      properties: { agent_id: { type: 'integer' }, item: ITEM, qty: QTY },
      required: ['agent_id', 'item'],
    },
  },
  {
    name: 'craft',
    description: 'Make a spear (35 damage) from 3 wood. At a lit fire, make your spear a flaming spear (100 damage).',
    parameters: {
      type: 'object',
      properties: { item: { type: 'string', enum: ['spear', 'flaming_spear'] } },
      required: ['item'],
    },
  },
  {
    name: 'build',
    description:
      'Add wood you are carrying to the shelter going up around the campfire at the centre, walking there first if needed. It needs 18 wood in all. Once finished, anyone inside stays warm through night, storm and winter, and wolves will not hunt them there.',
    parameters: {
      type: 'object',
      properties: { structure_id: { type: 'integer', description: 'id of the shelter' }, qty: QTY },
      required: ['structure_id'],
    },
  },
  {
    name: 'feed_fire',
    description:
      'Add wood you are carrying to a fire, walking to it first if needed. Each wood burns 30 seconds. The signal fire needs 15 wood before it can be lit; once burning, search planes can see it at night.',
    parameters: {
      type: 'object',
      properties: { structure_id: { type: 'integer' }, qty: QTY },
      required: ['structure_id'],
    },
  },
  {
    name: 'heal',
    description: 'Use a medkit you carry to treat a survivor (or yourself, with your own id); you walk to them first if needed. Critical wounds do not heal without one.',
    parameters: {
      type: 'object',
      properties: { agent_id: { type: 'integer' } },
      required: ['agent_id'],
    },
  },
  {
    name: 'help',
    description: 'Go to someone pinned under a fallen tree and lift it off them (takes a few seconds).',
    parameters: {
      type: 'object',
      properties: { agent_id: { type: 'integer' } },
      required: ['agent_id'],
    },
  },
  {
    name: 'fire_flare',
    description: 'Fire a flare you carry into the sky. If a search plane is overhead at that moment, it sees you and lands. Fired at any other time, the flare is lost. You only get one.',
    parameters: { type: 'object', properties: {} },
  },
  {
    name: 'attack',
    description:
      'Go after another survivor (agent_id) or a wolf (wolf_id) and keep hitting until they are knocked out or you choose another action.',
    parameters: {
      type: 'object',
      properties: { agent_id: { type: 'integer' }, wolf_id: { type: 'integer' } },
    },
  },
  {
    name: 'say',
    description: 'Say something out loud. Everyone within 8 tiles hears it. Give "to" to address one person.',
    parameters: {
      type: 'object',
      properties: {
        text: { type: 'string', maxLength: 200 },
        to: { type: 'integer', description: 'id of the person you are talking to (optional)' },
      },
      required: ['text'],
    },
  },
  {
    name: 'whisper',
    description: 'Whisper to someone within 3 tiles. Only they hear it.',
    parameters: {
      type: 'object',
      properties: { agent_id: { type: 'integer' }, text: { type: 'string', maxLength: 200 } },
      required: ['agent_id', 'text'],
    },
  },
  {
    name: 'idle',
    description: 'Stop and wait.',
    parameters: { type: 'object', properties: {} },
  },
];
