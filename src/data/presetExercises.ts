import type { BodyPart } from '../lib/types';

export interface PresetExercise {
  id: string;
  name: string;
  bodyPart: BodyPart;
}

export const PRESET_EXERCISES: PresetExercise[] = [
  // 胸 6
  { id: 'p-bench', name: '卧推', bodyPart: 'chest' },
  { id: 'p-incline-bench', name: '上斜卧推', bodyPart: 'chest' },
  { id: 'p-db-fly', name: '哑铃飞鸟', bodyPart: 'chest' },
  { id: 'p-dip', name: '双杠臂屈伸', bodyPart: 'chest' },
  { id: 'p-cable-fly', name: '绳索夹胸', bodyPart: 'chest' },
  { id: 'p-pushup', name: '俯卧撑', bodyPart: 'chest' },
  // 肩 6
  { id: 'p-ohp', name: '站姿推举', bodyPart: 'shoulder' },
  { id: 'p-lat-raise', name: '哑铃侧平举', bodyPart: 'shoulder' },
  { id: 'p-face-pull', name: '面拉', bodyPart: 'shoulder' },
  { id: 'p-front-raise', name: '前平举', bodyPart: 'shoulder' },
  { id: 'p-reverse-fly', name: '反向飞鸟', bodyPart: 'shoulder' },
  { id: 'p-shrug', name: '耸肩', bodyPart: 'shoulder' },
  // 背 6
  { id: 'p-pullup', name: '引体向上', bodyPart: 'back' },
  { id: 'p-lat-pulldown', name: '高位下拉', bodyPart: 'back' },
  { id: 'p-bb-row', name: '杠铃划船', bodyPart: 'back' },
  { id: 'p-seated-row', name: '坐姿划船', bodyPart: 'back' },
  { id: 'p-straight-arm', name: '直臂下拉', bodyPart: 'back' },
  { id: 'p-deadlift', name: '硬拉', bodyPart: 'back' },
  // 腿 6
  { id: 'p-squat', name: '深蹲', bodyPart: 'leg' },
  { id: 'p-leg-press', name: '腿举', bodyPart: 'leg' },
  { id: 'p-leg-ext', name: '腿屈伸', bodyPart: 'leg' },
  { id: 'p-leg-curl', name: '腿弯举', bodyPart: 'leg' },
  { id: 'p-bulgarian', name: '保加利亚分腿蹲', bodyPart: 'leg' },
  { id: 'p-calf-raise', name: '提踵', bodyPart: 'leg' },
  // 手臂 6
  { id: 'p-bb-curl', name: '杠铃弯举', bodyPart: 'arm' },
  { id: 'p-db-curl', name: '哑铃弯举', bodyPart: 'arm' },
  { id: 'p-hammer-curl', name: '锤式弯举', bodyPart: 'arm' },
  { id: 'p-pushdown', name: '绳索下压', bodyPart: 'arm' },
  { id: 'p-skull-crusher', name: '仰卧臂屈伸', bodyPart: 'arm' },
  { id: 'p-close-bench', name: '窄距卧推', bodyPart: 'arm' },
  // 核心 4
  { id: 'p-crunch', name: '卷腹', bodyPart: 'core' },
  { id: 'p-plank', name: '平板支撑', bodyPart: 'core' },
  { id: 'p-hanging-leg', name: '悬垂举腿', bodyPart: 'core' },
  { id: 'p-russian-twist', name: '俄罗斯转体', bodyPart: 'core' },
  // 有氧 6
  { id: 'p-run', name: '跑步', bodyPart: 'cardio' },
  { id: 'p-bike', name: '单车', bodyPart: 'cardio' },
  { id: 'p-elliptical', name: '椭圆机', bodyPart: 'cardio' },
  { id: 'p-rope', name: '跳绳', bodyPart: 'cardio' },
  { id: 'p-rowing', name: '划船机', bodyPart: 'cardio' },
  { id: 'p-stairs', name: '爬楼机', bodyPart: 'cardio' },
];
