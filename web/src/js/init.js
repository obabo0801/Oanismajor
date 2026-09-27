import * as dom from "#common/dom";
import device from "#common/device";
import theme from "#ui/theme";
import icon from "#common/icon";
import button from "#common/button";
import accordion from "#common/accordion";
import input from "#common/input";
import tooltip from "#common/tooltip";
import choice from "#common/choice";
import switches from "#common/switch";
import * as select from "#common/select";
import * as stepper from "#common/stepper";
import * as toggle from "#common/toggle";
import * as picker from "#common/picker";
import * as keypad from "#common/keypad";
import mount, { register } from "#common/mount";
import group from "#common/group";
import chatting from "#common/chatting";
import range from "#common/range";
import player from "#common/player";
import segment from "#common/segment";
import scroll from "#common/scroll";
import drag from "#common/drag";
import progress from "#common/progress";

let loading;

export default function init() {
  if (loading) return loading;

  register(
    group,
    chatting,
    player,
    range,
    select.default,
    stepper.default,
    picker.default,
    toggle.default
  );

  loading = dom.create("div");

  loading.className = "loading";

  const indicator = loading;

  setTimeout(() => {
    if (indicator.isConnected)
      progress({ type: "circular", value: 25, show: false, target: indicator });
  }, 500);

  dom.body.append(loading);

  device();
  theme();
  icon();
  button();
  accordion();
  input();
  tooltip();
  choice();
  switches();
  segment();
  select.listen();
  stepper.listen();
  toggle.listen();
  picker.listen();
  keypad.listen();
  mount();
  scroll();
  drag();

  return loading;
}
