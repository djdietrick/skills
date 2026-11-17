// Fixture pages served by the simulated OpenFin backend.
//
// Each fixture becomes one page (one CDP page target) at /page/<id>, with a
// fake `fin` global injected unless `fin: false`.
//
//   {
//     id: string,            // unique; used in the URL and by sim.openPage(id)
//     uuid: string, name: string,   // OpenFin identity (fin.me.identity)
//     kind: 'window' | 'view',
//     parent?: string,       // views only: fixture id of the parent window
//     title?: string,        // document.title
//     body?: string,         // inner HTML of <body>
//     open?: boolean,        // false = not opened at startup (open later with sim.openPage)
//     fin?: boolean,         // false = plain page with no `fin` global
//     parentApi?: boolean,   // views: false = getCurrentWindow() rejects (parent only via platform snapshot)
//   }
//
// Later tickets extend DEFAULT_FIXTURES (or pass their own list) with the
// elements they need to click, type into, read, or log from.
export const DEFAULT_FIXTURES = [
  {
    id: 'main',
    uuid: 'sim-app',
    name: 'main',
    kind: 'window',
    title: 'Sim App — Main',
    body: '<h1>Main window</h1><p id="greeting">Hello from main</p>',
  },
  {
    id: 'secondary',
    uuid: 'sim-app',
    name: 'secondary',
    kind: 'window',
    title: 'Sim App — Secondary',
    body: '<h1>Secondary window</h1>',
  },
  {
    id: 'blotter',
    uuid: 'sim-app',
    name: 'blotter-view',
    kind: 'view',
    parent: 'main',
    title: 'Blotter',
    body: '<h1>Blotter</h1><table id="orders"><tr><td>AAPL</td><td>100</td></tr></table>',
  },
  {
    id: 'home',
    uuid: 'openfin-workspace',
    name: 'openfin-home',
    kind: 'window',
    title: 'Home',
    body: '<input id="search" placeholder="Search">',
  },
];
