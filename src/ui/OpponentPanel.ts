import Phaser from 'phaser';
import type { GameLoop } from '../systems/GameLoop.ts';
import type { OpponentAI } from '../systems/Duel.ts';
import type { BettingSystem } from '../systems/Betting.ts';
import { GAME_WIDTH, GAME_HEIGHT } from '../config.ts';
import { Button } from './Button.ts';
import { COLORS, FONT, OUTLINE, HAND_NAME, SUIT_COLOR, SUIT_SYMBOL } from './theme.ts';
import type { Suit } from '../systems/PokerEvaluator.ts';

const GRID_N = 5;
const CELL = 120;

/**
 * 상대 진행 상황 패널 (위로 스와이프 → 아래에서 올라옴): 상대 AI의 웨이브·라이프·골드·페이즈·시너지·필드 미니맵
 */
export class OpponentPanel extends Phaser.GameObjects.Container {
  private status: Phaser.GameObjects.Text;
  private syn: Phaser.GameObjects.Text;
  private cells: Phaser.GameObjects.Rectangle[] = [];
  private cellText: Phaser.GameObjects.Text[] = [];
  private compare: Phaser.GameObjects.Text;
  private ledger: Phaser.GameObjects.Text;

  constructor(scene: Phaser.Scene, onClose: () => void) {
    super(scene, 0, GAME_HEIGHT);
    const bg = scene.add.rectangle(GAME_WIDTH / 2, GAME_HEIGHT / 2, GAME_WIDTH, GAME_HEIGHT, COLORS.bg).setInteractive();
    this.add(bg);
    this.add(scene.add.rectangle(GAME_WIDTH / 2, 2, GAME_WIDTH, 4, COLORS.panelLine));
    this.add(scene.add.rectangle(GAME_WIDTH / 2, 90, GAME_WIDTH, 180, COLORS.panel));
    this.add(scene.add.text(40, 70, '상대 진행 상황', { fontSize: '46px', color: COLORS.text, fontFamily: FONT.display, ...OUTLINE }).setOrigin(0, 0.5));
    this.add(scene.add.text(40, 130, '실시간 레이스 · 40라운드 먼저 클리어 = 승리 · 라운드마다 판돈은 더 잘 막은 쪽이', { fontSize: '24px', color: COLORS.textDim, fontFamily: FONT.body, wordWrap: { width: GAME_WIDTH - 330 } }).setOrigin(0, 0.5));
    this.add(new Button(scene, GAME_WIDTH - 150, 90, '▼ 닫기', () => onClose(), { width: 220, height: 90, fontSize: 32, variant: 'gray' }));

    this.status = scene.add.text(GAME_WIDTH / 2, 260, '', { fontSize: '40px', color: COLORS.text, fontFamily: FONT.display, ...OUTLINE, align: 'center' }).setOrigin(0.5);
    this.syn = scene.add.text(GAME_WIDTH / 2, 330, '', { fontSize: '26px', color: COLORS.textDim, fontFamily: FONT.body, align: 'center', wordWrap: { width: GAME_WIDTH - 80 } }).setOrigin(0.5);
    this.compare = scene.add.text(GAME_WIDTH / 2, 1100, '', { fontSize: '30px', color: '#8fe3ff', fontFamily: FONT.body, align: 'center' }).setOrigin(0.5);
    this.ledger = scene.add.text(GAME_WIDTH / 2, 1230, '', { fontSize: '26px', color: COLORS.textDim, fontFamily: FONT.body, align: 'center', wordWrap: { width: GAME_WIDTH - 80 } }).setOrigin(0.5, 0);
    this.add([this.status, this.syn, this.compare, this.ledger]);

    // 미니 필드
    const gx = (GAME_WIDTH - GRID_N * CELL) / 2;
    const gy = 420;
    this.add(scene.add.rectangle(GAME_WIDTH / 2, gy + (GRID_N * CELL) / 2, GRID_N * CELL + 60, GRID_N * CELL + 60, COLORS.track).setStrokeStyle(3, COLORS.trackLine));
    for (let i = 0; i < GRID_N * GRID_N; i++) {
      const x = gx + (i % GRID_N) * CELL + CELL / 2;
      const y = gy + Math.floor(i / GRID_N) * CELL + CELL / 2;
      const r = scene.add.rectangle(x, y, CELL - 8, CELL - 8, COLORS.cell).setStrokeStyle(2, COLORS.cellLine);
      const t = scene.add.text(x, y, '', { fontSize: '30px', color: '#0b0e14', fontFamily: FONT.display, ...OUTLINE }).setOrigin(0.5);
      this.cells.push(r); this.cellText.push(t);
      this.add([r, t]);
    }
    this.add(scene.add.text(GAME_WIDTH / 2, GAME_HEIGHT - 36, '▼ 아래로 스와이프하면 게임 화면', { fontSize: '24px', color: COLORS.textMuted, fontFamily: FONT.body }).setOrigin(0.5));
    scene.add.existing(this);
  }

  refresh(opp: OpponentAI, player: GameLoop, totalWaves: number, betting?: BettingSystem): void {
    const g = opp.loop;
    const phase: Record<string, string> = { card: '카드 선택 중', manage: '정비 중', combat: '전투 중', victory: '40웨이브 클리어!', defeat: '탈락' };
    const hand = opp.lastHandRank !== null ? `   최근 족보: ${HAND_NAME[opp.lastHandRank]}` : '';
    this.status.setText(`라운드 ${g.wave}/${totalWaves}   ♥ ${g.life}   💰 ${Math.floor(g.gold)}   · ${phase[g.phase] ?? g.phase}${hand}`);
    const syn = g.activeSynergies.map((s) => (s.kind === 'suit' ? `${SUIT_SYMBOL[s.key as Suit]}${s.reached}` : s.reached === 1 ? s.name : `${s.name}${s.reached}`)).join('  ');
    const hero = g.hero ? `   영웅: ${g.hero.def.name} (${g.hero.grade})` : '';
    this.syn.setText(`유닛 ${g.units.length}/25   시너지: ${syn || '없음'}${hero}`);
    const bySlot = new Map<number, { suit: Suit; tier: number; hero: boolean }>();
    for (const u of g.units) bySlot.set(u.slot, { suit: u.def.suit, tier: u.def.tier, hero: false });
    if (g.hero) bySlot.set(g.hero.unit.slot, { suit: g.hero.unit.def.suit, tier: 0, hero: true });
    this.cells.forEach((c, i) => {
      const u = bySlot.get(i);
      c.setFillStyle(u ? SUIT_COLOR[u.suit] : COLORS.cell);
      this.cellText[i].setText(u ? (u.hero ? '★' : `${u.tier}`) : '');
    });
    const lead = g.wave === player.wave ? '같은 라운드' : g.wave > player.wave ? `상대가 ${g.wave - player.wave}라운드 앞섬` : `내가 ${player.wave - g.wave}라운드 앞섬`;
    this.compare.setText(`나: 라운드 ${player.wave} ♥${player.life}   vs   상대: 라운드 ${g.wave} ♥${g.life}\n${lead}`);
    if (betting) {
      const recent = betting.history.slice(-6).map((r) => `R${r.wave} ${r.winner === 'player' ? '나 +' : r.winner === 'opponent' ? '상대 +' : '이월 '}💰${r.pot}`).join('  ·  ');
      this.ledger.setText(`판돈 획득 합계: 나 💰${betting.won.player} / 상대 💰${betting.won.opponent}${betting.carry ? `   (이월 💰${betting.carry})` : ''}\n${recent || '아직 판정된 라운드 없음'}`);
    }
  }
}
