# Changelog

## [0.3.0](https://github.com/Serraniel/nepfleet-ui/compare/v0.2.0...v0.3.0) (2026-11-14)


### Features

* **access:** download the age key, encrypted to your public key ([#96](https://github.com/Serraniel/nepfleet-ui/issues/96)) ([dbd5e06](https://github.com/Serraniel/nepfleet-ui/commit/dbd5e068854a23ad7fe23aa77652f6947c4f75de))
* **access:** manage API tokens from the app ([#88](https://github.com/Serraniel/nepfleet-ui/issues/88)) ([4a9f86e](https://github.com/Serraniel/nepfleet-ui/commit/4a9f86e88a752e88ae7527a13a309fc3157fc759))
* **access:** manage people and their passkeys from the app ([#92](https://github.com/Serraniel/nepfleet-ui/issues/92)) ([0f2b51b](https://github.com/Serraniel/nepfleet-ui/commit/0f2b51bcfde4937482f6f21ec2108efa63dce297))
* **features:** enable NepFleet's opt-in features from the app ([#87](https://github.com/Serraniel/nepfleet-ui/issues/87)) ([af9185c](https://github.com/Serraniel/nepfleet-ui/commit/af9185cb93a0cc6db7b59f6fbf3a415b76cf7035))
* **fleets:** ask for the sudo password in the setup dialog ([#79](https://github.com/Serraniel/nepfleet-ui/issues/79)) ([571eeef](https://github.com/Serraniel/nepfleet-ui/commit/571eeefaa634c563adb9c2d0d64d923505836fa4))
* **fleets:** set up a machine's network mounts from the app ([#102](https://github.com/Serraniel/nepfleet-ui/issues/102)) ([41b2cff](https://github.com/Serraniel/nepfleet-ui/commit/41b2cff1ea02e6e41db597cbb2f613f0a1fd1f23))
* **fleets:** unlock SSH keys with a passphrase from the app ([#83](https://github.com/Serraniel/nepfleet-ui/issues/83)) ([688a2b2](https://github.com/Serraniel/nepfleet-ui/commit/688a2b2c90588a29817b3a94cb46f0f783647136))
* **health:** see and run a backend's repository mirrors ([#97](https://github.com/Serraniel/nepfleet-ui/issues/97)) ([49a59df](https://github.com/Serraniel/nepfleet-ui/commit/49a59df0d4bb85033025025780c84d9e6c8bf2a9))
* **health:** the hosts' doctor and security checks in the app ([#91](https://github.com/Serraniel/nepfleet-ui/issues/91)) ([61fc194](https://github.com/Serraniel/nepfleet-ui/commit/61fc194cdda7645fd95be8857cab6f0e9406b60f))
* **import:** import running Compose projects as stacks from the app ([#101](https://github.com/Serraniel/nepfleet-ui/issues/101)) ([6ba136c](https://github.com/Serraniel/nepfleet-ui/commit/6ba136c5c842f6496b6437503c6907d2060a1393))
* **native:** a prototype desktop app with native Qt controls ([#82](https://github.com/Serraniel/nepfleet-ui/issues/82)) ([bf09a69](https://github.com/Serraniel/nepfleet-ui/commit/bf09a69d83bf975998dc56dc07e7c59075376067))
* **notifications:** events from the backends in the browser, without the daemon ([#98](https://github.com/Serraniel/nepfleet-ui/issues/98)) ([fa285df](https://github.com/Serraniel/nepfleet-ui/commit/fa285dfbb07acc5f3522899a79156b2e7093ae62))
* **notifications:** send a test message to a backend's channels ([#89](https://github.com/Serraniel/nepfleet-ui/issues/89)) ([2abfe25](https://github.com/Serraniel/nepfleet-ui/commit/2abfe253408ce23207e5c942b959a19e5cab3b0e))
* **stacks:** allow picked egress destinations from the stack's page ([#93](https://github.com/Serraniel/nepfleet-ui/issues/93)) ([2fb3346](https://github.com/Serraniel/nepfleet-ui/commit/2fb3346480fd61abf95f2104a470654c023255f7))
* **stacks:** download a stack's or the fleet's SBOM ([#90](https://github.com/Serraniel/nepfleet-ui/issues/90)) ([ee8a0c4](https://github.com/Serraniel/nepfleet-ui/commit/ee8a0c49e3b20abe31f742283f345b46cbbe9be4))
* **stacks:** find a catalogue template for a plain stack ([#99](https://github.com/Serraniel/nepfleet-ui/issues/99)) ([1de08da](https://github.com/Serraniel/nepfleet-ui/commit/1de08da15f522c228e10f9332a618ddeaa81ccbd))
* **stacks:** restore a stack's volumes from a backup in the app ([#100](https://github.com/Serraniel/nepfleet-ui/issues/100)) ([ab7cba0](https://github.com/Serraniel/nepfleet-ui/commit/ab7cba01b0fd7c525c73c00b57e4e7918ad37545))
* **stacks:** set, replace and remove a stack's secrets ([#86](https://github.com/Serraniel/nepfleet-ui/issues/86)) ([54bc401](https://github.com/Serraniel/nepfleet-ui/commit/54bc401bc949a0c9b2cab0be09bef0e12fa50466))
* **stacks:** view a stack's rendered files, secrets masked ([#94](https://github.com/Serraniel/nepfleet-ui/issues/94)) ([9abbca5](https://github.com/Serraniel/nepfleet-ui/commit/9abbca578d3a41d1fdd2db1ba50a0d0f497f7e20))
* **sync:** show each server's Git sync and sync on demand ([#85](https://github.com/Serraniel/nepfleet-ui/issues/85)) ([02030f2](https://github.com/Serraniel/nepfleet-ui/commit/02030f28db19ee0448d386e4b5d74b93ea173bed))
* **templates:** create a stack from the template wizard ([#84](https://github.com/Serraniel/nepfleet-ui/issues/84)) ([c00565d](https://github.com/Serraniel/nepfleet-ui/commit/c00565d98c2a44188da3e7419fd075506c7617a1))
* **updates:** run a backend's updates now and follow the log ([#95](https://github.com/Serraniel/nepfleet-ui/issues/95)) ([c662322](https://github.com/Serraniel/nepfleet-ui/commit/c662322b631d123f27a2f2704085b3a5749330fb))


### Bug Fixes

* **fleets:** offer Connect only where NepFleet runs ([#77](https://github.com/Serraniel/nepfleet-ui/issues/77)) ([12dcbe2](https://github.com/Serraniel/nepfleet-ui/commit/12dcbe27bfebe0f810a03d647bc7c812d5660771))

## [0.2.0](https://github.com/Serraniel/nepfleet-ui/compare/v0.1.0...v0.2.0) (2026-11-13)


### Features

* Arch package for the desktop app ([#68](https://github.com/Serraniel/nepfleet-ui/issues/68)) ([6365c66](https://github.com/Serraniel/nepfleet-ui/commit/6365c665b90d70c3980513d580b5ba67d188da7f))
* **desktop:** installers for every release, with the nepfleet command inside ([#75](https://github.com/Serraniel/nepfleet-ui/issues/75)) ([92d1321](https://github.com/Serraniel/nepfleet-ui/commit/92d13216a75f79da7fba028205b0666c1a5f76ba))
* **desktop:** tray icon, and a second start shows the window ([#74](https://github.com/Serraniel/nepfleet-ui/issues/74)) ([b59cdf9](https://github.com/Serraniel/nepfleet-ui/commit/b59cdf935ec488a522d5aac48ab32e8f0143c309))
* edit a stack's files and save them as a commit ([#70](https://github.com/Serraniel/nepfleet-ui/issues/70)) ([cb4c5fa](https://github.com/Serraniel/nepfleet-ui/commit/cb4c5fa55409b72413802d6e20f3d8a9b30aa340))
* filter stacks by state ([#71](https://github.com/Serraniel/nepfleet-ui/issues/71)) ([9451ddd](https://github.com/Serraniel/nepfleet-ui/commit/9451dddb9a816453c1633f6813676e7a3460ac78))
* prepare a machine and install NepFleet from the Fleets page ([#69](https://github.com/Serraniel/nepfleet-ui/issues/69)) ([a645485](https://github.com/Serraniel/nepfleet-ui/commit/a645485bc53e647063f373df1bcaadf0c1e5a0d4))


### Bug Fixes

* point SSH addresses to the Fleets page ([#64](https://github.com/Serraniel/nepfleet-ui/issues/64)) ([fce2291](https://github.com/Serraniel/nepfleet-ui/commit/fce2291576a5b21fff8748306061615db5bad5a9))


### Dependencies

* Bump node from `c6ad9e9` to `8996bb5` ([#67](https://github.com/Serraniel/nepfleet-ui/issues/67)) ([6c3888b](https://github.com/Serraniel/nepfleet-ui/commit/6c3888b689ecc5d11d54c5220c04af4cb8c43775))

## 0.1.0 (2026-11-08)


### Features

* apply a reviewed plan from the stack page ([#41](https://github.com/Serraniel/nepfleet-ui/issues/41)) ([2e8e875](https://github.com/Serraniel/nepfleet-ui/commit/2e8e8759ec974e6e62f7bf4a1bbadd9cb1c7c446))
* check a stack's images for updates from its page ([#58](https://github.com/Serraniel/nepfleet-ui/issues/58)) ([02fc181](https://github.com/Serraniel/nepfleet-ui/commit/02fc181eca274276031c06c284fd8aba0eae88e3))
* design system: tokens, components and a showcase page ([#33](https://github.com/Serraniel/nepfleet-ui/issues/33)) ([e807c9b](https://github.com/Serraniel/nepfleet-ui/commit/e807c9b5d4e5f145119d88a0cc3b149951f00016))
* desktop app for Linux, Windows and macOS ([#46](https://github.com/Serraniel/nepfleet-ui/issues/46)) ([2492465](https://github.com/Serraniel/nepfleet-ui/commit/249246521e012e6158ebd40f47aafe2d5441bddf))
* initial version ([3dd7a61](https://github.com/Serraniel/nepfleet-ui/commit/3dd7a61d41a2f323893e9660752e386f2fd6824f))
* link a stack to its address, logs and monitors ([#54](https://github.com/Serraniel/nepfleet-ui/issues/54)) ([af8b92d](https://github.com/Serraniel/nepfleet-ui/commit/af8b92d9714ee5af38ebf6f0c98bad6dab091060))
* local mode, manage all fleets through the control daemon ([#44](https://github.com/Serraniel/nepfleet-ui/issues/44)) ([8708029](https://github.com/Serraniel/nepfleet-ui/commit/87080295be92d2c51275ccc7a0293ffbef99e0e9))
* maintenance view across backends ([#60](https://github.com/Serraniel/nepfleet-ui/issues/60)) ([f1d6fb5](https://github.com/Serraniel/nepfleet-ui/commit/f1d6fb5c5ab30d1775e1a929aae3ad75d0fde07b))
* notifications in the web and desktop app ([#49](https://github.com/Serraniel/nepfleet-ui/issues/49)) ([0ba34eb](https://github.com/Serraniel/nepfleet-ui/commit/0ba34eb7cd86c2d615fa521139d22a2a943bf0ba))
* plan view shows the stack's egress mode ([#57](https://github.com/Serraniel/nepfleet-ui/issues/57)) ([a66b8c1](https://github.com/Serraniel/nepfleet-ui/commit/a66b8c15b13c9437d36afce9b64b83d941f9d0fe))
* review and take image updates from a stack's page ([#59](https://github.com/Serraniel/nepfleet-ui/issues/59)) ([2a5c087](https://github.com/Serraniel/nepfleet-ui/commit/2a5c0877ac9c7805faa4e017c41a59ef5397c41a))
* roll a stack back from its history ([#50](https://github.com/Serraniel/nepfleet-ui/issues/50)) ([6fb5c83](https://github.com/Serraniel/nepfleet-ui/commit/6fb5c83f7e36437d66c4e321b386b4af6b566ff8))
* show what a stack's egress recorded or refused ([#61](https://github.com/Serraniel/nepfleet-ui/issues/61)) ([0c4c1e9](https://github.com/Serraniel/nepfleet-ui/commit/0c4c1e9f6c6745e0ad96c43e7438230a198f4f32))
* show which stacks use each other's values ([#55](https://github.com/Serraniel/nepfleet-ui/issues/55)) ([e7133c6](https://github.com/Serraniel/nepfleet-ui/commit/e7133c6006ba32617a4c0a2f9aa1e654afb34b02))
* sign in through an identity provider ([#53](https://github.com/Serraniel/nepfleet-ui/issues/53)) ([4f28c03](https://github.com/Serraniel/nepfleet-ui/commit/4f28c03b9daa7c53e4a12b0e48fa891a3cfa4871))
* sign in to a backend with a passkey ([#51](https://github.com/Serraniel/nepfleet-ui/issues/51)) ([f6a33f4](https://github.com/Serraniel/nepfleet-ui/commit/f6a33f4205db933cd41367c6f76adc9035ff1525))
* sign in with a code when no passkey is at hand ([#52](https://github.com/Serraniel/nepfleet-ui/issues/52)) ([eedd26f](https://github.com/Serraniel/nepfleet-ui/commit/eedd26fb65570a6659f38b078dd0a1e928be557c))
* stack list across backends with API tokens ([#38](https://github.com/Serraniel/nepfleet-ui/issues/38)) ([b30d7d9](https://github.com/Serraniel/nepfleet-ui/commit/b30d7d9a3e12f707b9d22d26af318b2f2790ef4c))
* stack page with pending changes and history ([#39](https://github.com/Serraniel/nepfleet-ui/issues/39)) ([032c101](https://github.com/Serraniel/nepfleet-ui/commit/032c10114a16447a3c9ef72abcced387e6513510))
* template catalogue and input wizard ([#40](https://github.com/Serraniel/nepfleet-ui/issues/40)) ([49d02ed](https://github.com/Serraniel/nepfleet-ui/commit/49d02eda10bd887ef8f25d73d8ef39ebb4c62eea))
* theme follows the system, with a light or dark override ([#30](https://github.com/Serraniel/nepfleet-ui/issues/30)) ([4642be1](https://github.com/Serraniel/nepfleet-ui/commit/4642be1f73fe5d1cf39736a2ed5c92918a0d1275))
* updates page across every stack ([#62](https://github.com/Serraniel/nepfleet-ui/issues/62)) ([7d91f8c](https://github.com/Serraniel/nepfleet-ui/commit/7d91f8c1dc061d74123a3c720e65a7feac47a7da))
* verify with a passkey before adding one, when the backend asks ([#56](https://github.com/Serraniel/nepfleet-ui/issues/56)) ([e9a2df8](https://github.com/Serraniel/nepfleet-ui/commit/e9a2df8887c5c02445ca209dfd45331749b4c28b))
