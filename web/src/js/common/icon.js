import * as dom from "#common/dom";
import * as css from "#common/css";

const icons = {
  skip: ["M5 5v14l10-7Z", "M19 5v14"],
  file: [
    "M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8Z",
    "M14 2v6h6",
    "M8 13h8M8 17h5"
  ],
  male: [
    "M5 10V8a7 7 0 0 1 14 0v5a7 7 0 0 1-14 0Z",
    "M5 9c4 0 6-2 7-4 1 3 4 4 7 4",
    "M9 12h.01M15 12h.01M9 16q3 2 6 0"
  ],
  female: [
    "M5 10V8a7 7 0 0 1 14 0l2 13h-5M5 8 3 21h5",
    "M6 10c3 0 5-2 6-5 1 3 3 5 6 5v3a6 6 0 0 1-12 0Z",
    "M9 12h.01M15 12h.01M10 16q2 1 4 0"
  ],
  discord: [
    "M8 5 5 6C3 9 2 13 2 17l5 2 1-2m8-12 3 1c2 3 3 7 3 11l-5 2-1-2",
    "M8 6a14 14 0 0 1 8 0M7 16a12 12 0 0 0 10 0",
    "M9 11v2M15 11v2"
  ],
  home: ["M3 11 12 3l9 8", "M5 10v10h14V10", "M9 20v-6h6v6"],
  menu: ["M4 6h16", "M4 12h16", "M4 18h16"],
  admin: ["M12 2 3 6v6c0 5 9 10 9 10s9-5 9-10V6Z", "m8 12 3 3 5-6"],
  arrow: ["m9 18 6-6-6-6"],
  full: ["M8 3H3v5", "M16 3h5v5", "M8 21H3v-5", "M16 21h5v-5"],
  "full-exit": ["M9 3v6H3", "M15 3v6h6", "M9 21v-6H3", "M15 21v-6h6"],

  plus: ["M5 12h14", "M12 5v14"],
  minus: ["M5 12h14"],
  edit: ["M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4Z"],
  copy: ["M8 8h12v12H8z", "M4 16V4h12"],
  delete: ["M21 4H8l-7 8 7 8h13a2 2 0 0 0 2-2V6a2 2 0 0 0-2-2Z", "m10 9 6 6", "m16 9-6 6"],
  trash: ["M3 6h18", "M5 6l1 15h12l1-15", "M9 6V3h6v3", "M10 10v7M14 10v7"],
  close: ["M18 6 6 18", "m6 6 12 12"],
  reload: ["M20 11a8 8 0 1 0-2.34 5.66", "M20 4v7h-7"],
  rotate: [
    "M21 12a9 9 0 0 0-15.5-6.2L3 8",
    "M3 3v5h5",
    "M3 12a9 9 0 0 0 15.5 6.2L21 16",
    "M21 21v-5h-5"
  ],
  download: ["M12 3v12", "m7 10 5 5 5-5", "M5 21h14"],

  check: ["M20 6 9 17l-5-5"],
  pin: ["M8 3h8l-1 7 4 4v2H5v-2l4-4Z", "M12 16v6"],
  info: ["M21 12a9 9 0 1 1-18 0" + " 9 9 0 0 1 18 0Z", "M12 11v5", "M12 8h.01"],
  warning: [
    "M21.73 18l-8-14" + "a2 2 0 0 0-3.46 0" + "l-8 14A2 2 0 0 0 4 21h16" + "a2 2 0 0 0 1.73-3Z",
    "M12 9v4",
    "M12 17h.01"
  ],
  error: ["M21 12a9 9 0 1 1-18 0" + " 9 9 0 0 1 18 0Z", "M12 8v5", "M12 17h.01"],
  throbber: ["M21 12a9 9 0 1 1-9-9"],
  "eye-off": [
    "m3 3 18 18",
    "M10.6 10.6a2 2 0 0 0 2.8 2.8",
    "M9.9 4.2A10.5 10.5 0 0 1 12 4c5 0 9 4 10 8",
    "M6.2 6.2A12 12 0 0 0 2 12c1 4 5 8 10 8"
  ],

  user: ["M12 12a5 5 0 1 0 0-10 5 5 0 0 0 0 10Z", "M4 22v-2a8 8 0 0 1 16 0v2Z"],
  users: [
    "M9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8Z",
    "M2 21v-2a7 7 0 0 1 14 0v2",
    "M17 3a4 4 0 0 1 0 8",
    "M22 21v-2a7 7 0 0 0-4-6.3"
  ],
  login: ["M14 3h6v18h-6", "M3 12h12", "m10 7 5 5-5 5"],
  logout: ["M10 3H4v18h6", "M10 12h11", "m16 7 5 5-5 5"],

  chat: [
    "M5 3h14a2 2 0 0 1 2 2v11a2 2 0 0 1-2 2h-7l-4 3v-3H5" + "a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2Z",
    "M8 10.5h.01M12 10.5h.01M16 10.5h.01"
  ],
  send: ["M22 2 15 22l-4-9-9-4Z", "M22 2 11 13"],
  play: [
    [
      "path",
      {
        d: "M8 5Q8 4 9 4.7L19 11Q20.5 12 19 13L9 19.3Q8 20 8 19Z",
        fill: "currentColor",
        stroke: "none"
      }
    ]
  ],
  pause: [
    ["rect", { x: 6, y: 4, width: 4, height: 16, rx: 1.5, fill: "currentColor", stroke: "none" }],
    ["rect", { x: 14, y: 4, width: 4, height: 16, rx: 1.5, fill: "currentColor", stroke: "none" }]
  ],
  whisper: [
    "M6 8.5a6.5 6.5 0 1 1 13 0" + "c0 6-3 6-3 8.5a3.5 3.5 0 0 1-7 0",
    "M15 8.5a2.5 2.5 0 0 0-5 0v1" + "a2 2 0 0 0 2 2h1"
  ],
  smile: [
    "M12 22a10 10 0 1 0 0-20 10 10 0 0 0 0 20Z",
    "M8 9h.01M16 9h.01",
    "M7 14s1.5 3 5 3 5-3 5-3"
  ],
  gift: [
    "M20 12v10H4V12",
    "M2 7h20v5H2z",
    "M12 7v15",
    "M12 7H7.5a2.5 2.5 0 1 1 0-5C11 2 12 7 12 7Z",
    "M12 7h4.5a2.5 2.5 0 1 0 0-5C13 2 12 7 12 7Z"
  ],
  flag: ["M5 22V4", "M5 4h12l-2 4 2 4H5"],

  notify: ["M18 8a6 6 0 0 0-12 0" + "c0 7-3 7-3 9h18" + "c0-2-3-2-3-9", "M10 21h4"],
  "notify-mute": [
    "M18 8a6 6 0 0 0-12 0" + "c0 7-3 7-3 9h18" + "c0-2-3-2-3-9",
    "M10 21h4",
    "M3 3l18 18"
  ],
  vibration: ["M8 6h8v12H8z", "M4 8v8", "M1 10v4", "M20 8v8", "M23 10v4"],
  "vibration-off": ["M8 6h8v12H8z"],

  image: ["M3 5h18v14H3Z", "M8.5 11a1.5 1.5 0 1 0 0-3 1.5 1.5 0 0 0 0 3Z", "m3 17 5-5 4 4 3-3 6 6"],
  camera: [
    "M14.5 4h-5L7 7H4a2 2 0 0 0-2 2v9" +
      "a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2V9" +
      "a2 2 0 0 0-2-2h-3.5Z",
    "M12 17a4 4 0 1 0 0-8 4 4 0 0 0 0 8Z"
  ],
  media: [
    "M9 18V5l12-2v13M9 9l12-2",
    "M9 18a3 2 0 1 1-6 0 3 2 0 1 1 6 0Z",
    "M21 16a3 2 0 1 1-6 0 3 2 0 1 1 6 0Z"
  ],
  voice: [
    "M12 2a3 3 0 0 0-3 3v7" + "a3 3 0 0 0 6 0V5" + "a3 3 0 0 0-3-3Z",
    "M19 10v2a7 7 0 0 1-14 0v-2",
    "M12 19v3",
    "M8 22h8"
  ],
  tts: [
    "M6 4h12a3 3 0 0 1 3 3v7" +
      "a3 3 0 0 1-3 3h-5l-5 3v-3H6" +
      "a3 3 0 0 1-3-3V7" +
      "a3 3 0 0 1 3-3Z",
    "M8 9h8",
    "M8 12h6"
  ],
  "tts-mute": [
    "M6 4h12a3 3 0 0 1 3 3v7" +
      "a3 3 0 0 1-3 3h-5l-5 3v-3H6" +
      "a3 3 0 0 1-3-3V7" +
      "a3 3 0 0 1 3-3Z",
    "M8 9h8",
    "M8 12h6",
    "M3 3l18 18"
  ],
  wave: ["M4 10v4", "M8 7v10", "M12 4v16", "M16 7v10", "M20 10v4"],
  sound: ["M11 5 6 9H2v6h4l5 4Z", "M15.54 8.46a5 5 0 0 1 0 7.07", "M18.36 5.64a9 9 0 0 1 0 12.73"],
  "volume-high": [
    "M11 5 6 9H2v6h4l5 4Z",
    "M15.54 8.46a5 5 0 0 1 0 7.07",
    "M18.36 5.64a9 9 0 0 1 0 12.73"
  ],
  "volume-low": ["M11 5 6 9H2v6h4l5 4Z", "M15.54 8.46a5 5 0 0 1 0 7.07"],
  "volume-mute": ["M11 5 6 9H2v6h4l5 4Z", "M2 6 15 18"],

  setting: [
    "M12.22 2h-.44a2 2 0 0 0-2 2v.18" +
      "a2 2 0 0 1-1 1.73l-.43.25" +
      "a2 2 0 0 1-2 0l-.15-.08" +
      "a2 2 0 0 0-2.73.73l-.22.38" +
      "a2 2 0 0 0 .73 2.73l.15.1" +
      "a2 2 0 0 1 1 1.72v.51" +
      "a2 2 0 0 1-1 1.74l-.15.09" +
      "a2 2 0 0 0-.73 2.73l.22.38" +
      "a2 2 0 0 0 2.73.73l.15-.08" +
      "a2 2 0 0 1 2 0l.43.25" +
      "a2 2 0 0 1 1 1.73V20" +
      "a2 2 0 0 0 2 2h.44" +
      "a2 2 0 0 0 2-2v-.18" +
      "a2 2 0 0 1 1-1.73l.43-.25" +
      "a2 2 0 0 1 2 0l.15.08" +
      "a2 2 0 0 0 2.73-.73l.22-.38" +
      "a2 2 0 0 0-.73-2.73l-.15-.09" +
      "a2 2 0 0 1-1-1.74v-.51" +
      "a2 2 0 0 1 1-1.74l.15-.09" +
      "a2 2 0 0 0 .73-2.73l-.22-.38" +
      "a2 2 0 0 0-2.73-.73l-.15.08" +
      "a2 2 0 0 1-2 0l-.43-.25" +
      "a2 2 0 0 1-1-1.73V4" +
      "a2 2 0 0 0-2-2Z",

    "M12 15a3 3 0 1 0 0-6" + " 3 3 0 0 0 0 6Z"
  ],
  system: [
    "M14.7 6.3a1 1 0 0 0 0 1.4" +
      "l1.6 1.6a1 1 0 0 0 1.4 0" +
      "l3.77-3.77a6 6 0 0 1-7.94 7.94" +
      "l-6.91 6.91a2.12 2.12 0 0 1-3-3" +
      "l6.91-6.91a6 6 0 0 1 7.94-7.94Z"
  ],
  "system-mute": [
    "M14.7 6.3a1 1 0 0 0 0 1.4" +
      "l1.6 1.6a1 1 0 0 0 1.4 0" +
      "l3.77-3.77a6 6 0 0 1-7.94 7.94" +
      "l-6.91 6.91a2.12 2.12 0 0 1-3-3" +
      "l6.91-6.91a6 6 0 0 1 7.94-7.94Z",
    "M3 3l18 18"
  ],
  theme: ["M4 5h16v12H4z", "M8 21h8", "M12 17v4"],
  phone: [
    "M7 2h10a2 2 0 0 1 2 2v16a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2Z",
    "M10 5h4",
    "M12 18h.01"
  ],
  light: [
    "M12 16a4 4 0 1 0 0-8" + " 4 4 0 0 0 0 8Z",
    "M12 2v2",
    "M12 20v2",
    "M2 12h2",
    "M20 12h2",
    "M4.93 4.93l1.42 1.42",
    "M17.66 17.66l1.41 1.41",
    "M4.93 19.07l1.42-1.42",
    "M17.66 6.34l1.41-1.41"
  ],
  dark: ["M12 3a6 6 0 0 0 9 9" + " 9 9 0 1 1-9-9Z"],
  language: [
    "M12 22a10 10 0 1 0 0-20" + " 10 10 0 0 0 0 20Z",
    "M2 12h20",
    "M12 2a15 15 0 0 1 0 20",
    "M12 2a15 15 0 0 0 0 20"
  ],
  storage: [
    "M4 6c0-1.1 3.58-2 8-2" + "s8 .9 8 2-3.58 2-8 2" + "-8-.9-8-2Z",
    "M4 6v6" + "c0 1.1 3.58 2 8 2" + "s8-.9 8-2V6",
    "M4 12v6" + "c0 1.1 3.58 2 8 2" + "s8-.9 8-2v-6"
  ],
  cookie: [
    "M21 12a9 9 0 1 1-9-9",
    "M21 12a3 3 0 0 1-3-3 " + "3 3 0 0 1-3-3 " + "3 3 0 0 1-3-3",
    "M8.5 8.5h.01",
    "M8 15h.01",
    "M15 15h.01"
  ],
  link: [
    "M10 13a5 5 0 0 0 7 0l3-3a5 5 0 0 0-7-7l-2 2",
    "M14 11a5 5 0 0 0-7 0l-3 3a5 5 0 0 0 7 7l2-2"
  ],
  mail: [
    "M4 4h16a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2Z",
    "m22 6-10 7L2 6"
  ],
  search: ["M21 21l-4.35-4.35", "M10.5 18a7.5 7.5 0 1 0 0-15" + " 7.5 7.5 0 0 0 0 15Z"],
  calendar: ["M3 5h18v16H3Z", "M3 10h18", "M7 3v4", "M17 3v4"],
  clock: ["M12 22a10 10 0 1 0 0-20 10 10 0 0 0 0 20Z", "M12 6v6l4 2"]
};

icons.mention = [
  ...icons.user.map((d) => [
    "path",
    { d, transform: "translate(4 4) scale(.6667)", fill: "currentColor", stroke: "none" }
  ]),
  "M7 2H2v5M17 2h5v5M2 17v5h5M22 17v5h-5"
];

icons["media-mute"] = [...icons.media, "M3 3l18 18"];

icons["notify-ring"] = [...icons.notify, "M4 3a9 9 0 0 0-2 5M20 3a9 9 0 0 1 2 5"];

const colors = {
  kr: {
    viewBox: "0 0 640 480",
    paths: [
      [
        "g",
        { "fill-rule": "evenodd", transform: "translate(89.8 .4)scale(.9375)" },
        [
          ["path", { fill: "#fff", d: "M-95.8-.4H587v512H-95.8Z" }],
          [
            "g",
            { transform: "rotate(-56.3 361.6 -101.3)scale(10.66667)" },
            [
              [
                "g",
                {},
                [
                  ["path", { fill: "#000001", d: "M-6-26H6v2H-6Zm0 3H6v2H-6Zm0 3H6v2H-6Z" }],
                  [
                    "g",
                    { transform: "translate(0 44)" },
                    [["path", { fill: "#000001", d: "M-6-26H6v2H-6Zm0 3H6v2H-6Zm0 3H6v2H-6Z" }]]
                  ]
                ]
              ],
              ["path", { stroke: "#fff", d: "M0 17v10" }],
              ["path", { fill: "#cd2e3a", d: "M0-12a12 12 0 0 1 0 24Z" }],
              ["path", { fill: "#0047a0", d: "M0-12a12 12 0 0 0 0 24A6 6 0 0 0 0 0Z" }],
              ["circle", { cy: "-6", r: "6", fill: "#cd2e3a" }]
            ]
          ],
          [
            "g",
            { transform: "rotate(-123.7 191.2 62.2)scale(10.66667)" },
            [
              [
                "g",
                { transform: "translate(0 0)" },
                [
                  [
                    "g",
                    {},
                    [
                      ["path", { fill: "#000001", d: "M-6-26H6v2H-6Zm0 3H6v2H-6Zm0 3H6v2H-6Z" }],
                      [
                        "g",
                        { transform: "translate(0 44)" },
                        [["path", { fill: "#000001", d: "M-6-26H6v2H-6Zm0 3H6v2H-6Zm0 3H6v2H-6Z" }]]
                      ]
                    ]
                  ]
                ]
              ],
              ["path", { stroke: "#fff", d: "M0-23.5v3M0 17v3.5m0 3v3" }]
            ]
          ]
        ]
      ]
    ]
  },
  sun: {
    viewBox: "0 0 24 24",
    paths: [
      ["circle", { cx: "12", cy: "12", r: "5", fill: "#ffbd35" }],
      [
        "path",
        {
          d: "M12 1v3m0 16v3M1 12h3m16 0h3M4 4l2 2m12 12 2 2M4 20l2-2M18 6l2-2",
          stroke: "#ef8b18",
          "stroke-width": "2"
        }
      ]
    ]
  },
  "sun-low": {
    viewBox: "0 0 24 24",
    paths: [
      ["circle", { cx: "12", cy: "12", r: "5", fill: "#ffd877" }],
      ["path", { d: "M12 2v2m0 16v2M2 12h2m16 0h2", stroke: "#eead36", "stroke-width": "2" }]
    ]
  },
  moon: {
    viewBox: "0 0 24 24",
    paths: [["path", { d: "M19 16A9 9 0 0 1 8 3a9 9 0 1 0 11 13Z", fill: "#a8bffa" }]]
  },
  "moon-full": {
    viewBox: "0 0 24 24",
    paths: [
      ["circle", { cx: "12", cy: "12", r: "9", fill: "#c5d2f1" }],
      ["circle", { cx: "8", cy: "9", r: "2", fill: "#96acd4" }],
      ["circle", { cx: "15", cy: "15", r: "3", fill: "#a8bde1" }]
    ]
  }
};

const palette = {
  blue: "#3b82f6",
  purple: "#a855f7",
  gold: "#d99a16",
  teal: "#14a89a",
  slate: "#647b9d",
  pink: "#db5b9e",
  brown: "#b77942",
  red: "var(--error)",
  green: "var(--success)",
  mute: "var(--mute)"
};

const tints = {
  male: "blue",
  female: "purple",
  home: "blue",
  menu: "slate",
  arrow: "slate",
  full: "slate",
  "full-exit": "slate",
  plus: "green",
  minus: "mute",
  edit: "blue",
  copy: "blue",
  delete: "red",
  trash: "red",
  close: "slate",
  reload: "blue",
  rotate: "blue",
  download: "blue",
  check: "green",
  pin: "blue",
  info: "blue",
  warning: "gold",
  error: "red",
  throbber: "blue",
  "eye-off": "mute",
  admin: "slate",
  user: "slate",
  users: "purple",
  login: "blue",
  logout: "red",
  chat: "blue",
  send: "blue",
  play: "green",
  pause: "blue",
  whisper: "teal",
  smile: "gold",
  gift: "pink",
  flag: "red",
  notify: "gold",
  "notify-mute": "mute",
  vibration: "teal",
  "vibration-off": "mute",
  image: "green",
  camera: "teal",
  media: "purple",
  "media-mute": "mute",
  voice: "teal",
  tts: "teal",
  "tts-mute": "mute",
  wave: "teal",
  sound: "blue",
  "volume-high": "blue",
  "volume-low": "blue",
  "volume-mute": "mute",
  setting: "slate",
  system: "slate",
  "system-mute": "mute",
  theme: "blue",
  phone: "teal",
  light: "gold",
  dark: "purple",
  language: "blue",
  storage: "slate",
  cookie: "brown",
  link: "blue",
  mail: "blue",
  search: "blue",
  calendar: "blue",
  clock: "blue",
  mention: "purple",
  "notify-ring": "gold"
};

for (const name of Object.keys(icons)) {
  const color = palette[tints[name]] || "currentColor";

  colors[name] = {
    viewBox: "0 0 24 24",
    paths: icons[name].map((item) => {
      const [tag, attributes, ...children] =
        typeof item === "string" ? ["path", { d: item }] : item;

      return [
        tag,
        {
          stroke: color,
          "stroke-width": 2,
          "stroke-linecap": "round",
          "stroke-linejoin": "round",
          ...attributes,
          ...(attributes.fill === "currentColor" ? { fill: color } : {}),
          ...(name === "user" ? { fill: color, stroke: "none" } : {})
        },
        ...children
      ];
    })
  };
}

const images = {
  google: new URL("../../assets/google/g.png", import.meta.url).href,
  soop: new URL("../../assets/soop/icon.ico", import.meta.url).href
};

const extensions = ["gif", "ico", "jpeg", "jpg", "png", "svg", "webp"];

const positions = {
  left: "left",
  "←": "left",
  right: "right",
  "→": "right",
  top: "top",
  "↑": "top",
  "top-left": "top-left",
  "↖": "top-left",
  "top-right": "top-right",
  "↗": "top-right",
  bottom: "bottom",
  "↓": "bottom",
  "bottom-left": "bottom-left",
  "↙": "bottom-left",
  "bottom-right": "bottom-right",
  "↘": "bottom-right",
  center: "center"
};

const angles = { right: 0, bottom: 90, left: 180, top: -90 };

const isImage = (value) => {
  const path = value.split(/[?#]/)[0].toLowerCase();

  return extensions.some((extension) => path.endsWith(`.${extension}`));
};

const svg = (paths, viewBox = "0 0 24 24", color) => {
  const icon = dom.svg("svg");
  const create = (item) => {
    const [tag, attributes, children = []] =
      typeof item === "string" ? ["path", { d: item }] : item;
    const node = dom.svg(tag);

    for (const [key, value] of Object.entries(attributes)) {
      dom.set(
        node,
        key,
        color === false && ["fill", "stroke"].includes(key) && value !== "none"
          ? "currentColor"
          : value
      );
    }

    node.append(...children.map(create));

    return node;
  };

  dom.set(icon, "viewBox", viewBox);
  icon.classList.add("icon");
  if (color !== undefined) icon.classList.add("icon-color");

  icon.append(...paths.map(create));

  return icon;
};

const img = (source, element) => {
  const icon = dom.create("img");

  icon.src = source;
  icon.alt = "";
  icon.draggable = false;
  icon.classList.add("icon");

  dom.on(
    icon,
    "error",
    () => {
      const value = dom.get(element, "data-default")?.trim();

      if (value && value !== source) {
        dom.set(element, "data-icon", value);
      }
    },
    { once: true }
  );

  return icon;
};

const text = (value) => {
  const icon = dom.create("span");

  icon.textContent = value;
  icon.classList.add("icon", "icon-text");

  return icon;
};

const image = (source, element) => {
  if (element.hasAttribute("data-color")) return img(source, element);
  const icon = dom.create("span");

  icon.classList.add("icon", "icon-mask");
  css.set(icon, { "--icon-image": `url(${JSON.stringify(source)})` });

  return icon;
};

const render = (element) => {
  dom.query(":scope > .icon", element)?.remove();
  element.classList.remove("icon-left", "icon-right", "icon-top", "icon-bottom", "icon-center");

  const value = dom.get(element, "data-icon")?.trim();

  if (!value) {
    return;
  }

  const parts = value.split(/\s+/);
  const last = parts.at(-1);
  const position = Object.hasOwn(positions, last) ? positions[last] : null;

  if (position) {
    parts.pop();

    const classes = position.split("-").map((value) => `icon-${value}`);

    element.classList.add(...classes);
  }

  const name = parts.join(" ");

  if (!name) {
    return;
  }

  const color = element.hasAttribute("data-color");
  const colored = Object.hasOwn(colors, name) && (color || !Object.hasOwn(icons, name));

  const icon = colored
    ? svg(colors[name].paths, colors[name].viewBox, color)
    : Object.hasOwn(icons, name)
      ? svg(icons[name])
      : Object.hasOwn(images, name)
        ? image(images[name], element)
        : isImage(name)
          ? img(name, element)
          : text(name);

  const angle = dom.get(element, "data-angle")?.trim().toLowerCase();

  const degree = Object.hasOwn(angles, angle) ? angles[angle] : Number(angle);

  if (Number.isFinite(degree)) {
    icon.animate({ transform: `rotate(${degree}deg)` }, { duration: 0, fill: "forwards" });
  }

  element.prepend(icon);
};

const scan = (root = document) => {
  if (root.matches?.("[data-icon]")) {
    render(root);
  }

  dom.all("[data-icon]", root).forEach(render);
};

let observing = false;

export default function icon() {
  scan();

  if (observing) {
    return;
  }

  const observer = new MutationObserver((records) => {
    records.forEach((record) => {
      if (record.type === "attributes") {
        render(record.target);

        return;
      }

      record.addedNodes.forEach((node) => {
        if (node.nodeType === Node.ELEMENT_NODE) {
          scan(node);
        }
      });
    });
  });

  observer.observe(dom.root, {
    subtree: true,
    childList: true,
    attributes: true,
    attributeFilter: ["data-icon", "data-angle", "data-color"]
  });

  observing = true;
}
