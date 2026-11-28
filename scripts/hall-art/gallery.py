from PIL import Image, ImageDraw

def render():
  # 마을회관 2층 전시관 배경(위에서 본 픽셀, 16px 타일, 26×16칸 = 416×256). maps/hall2.ts와 좌표를 맞춘다.
  # 전시한 물고기(유리 상자)·확장 전 공사 테이프는 게임이 덧그린다(scene.ts drawGallery). build-hall-art.py가 부른다.
  T=16
  TW,TH=26,16
  W,H=TW*T,TH*T
  im=Image.new('RGB',(W,H),(40,33,53))
  d=ImageDraw.Draw(im)
  C=lambda h: tuple(int(h[i:i+2],16) for i in (1,3,5))
  def box(x0,y0,x1,y1,c): d.rectangle([x0,y0,x1,y1],fill=C(c))
  def tiles(x0,y0,x1,y1,a,b):
    for ty in range(y0,y1+1):
      for tx in range(x0,x1+1):
        box(tx*T,ty*T,tx*T+T-1,ty*T+T-1,a if (tx+ty)%2 else b)
  WALL='#efe9df'; WALLF='#d7cfc2'
  MARBLE='#e8e4dc'; MARBLE2='#dcd6cb'; VEIN='#cfc7ba'
  CARPET='#8e2a2e'; GOLD='#c9a54a'; GOLDL='#e6c96f'
  STONE='#bdb6aa'; STONEL='#d9d3c8'; STONED='#8f897f'
  WOOD='#8a5a3a'; WOODL='#a8754c'
  PARQ='#b98b5e'; PARQ2='#a97b50'
  # 바닥: 대리석 체크 + 결
  tiles(1,1,TW-2,TH-2,MARBLE,MARBLE2)
  for (x,y) in ((3,4),(8,8),(14,5),(19,11),(5,11),(21,3),(11,7)):
    d.line([(x*T+2,y*T+3),(x*T+12,y*T+9)],fill=C(VEIN),width=1)
  # 확장 구역(아래 띠 y13~14, x1~20): 나무 마루 + 번호판
  for k,tx in enumerate((1,5,9,13,17)):
    for ty in (13,14):
      for xx in range(tx,tx+4):
        for i in range(4):
          box(xx*T,ty*T+i*4,xx*T+T-1,ty*T+i*4+3,PARQ if (i+xx)%2 else PARQ2)
    box(tx*T,13*T,tx*T+4*T-1,13*T,'#7a5634')
    px,py=tx*T+2*T-5,13*T+3
    box(px,py,px+9,py+8,'#f7f7f4'); box(px,py+8,px+9,py+8,STONED)
  DIG={1:['.#.','##.','.#.','.#.','###'],2:['##.','..#','.#.','#..','###'],3:['##.','..#','.#.','..#','##.'],4:['#.#','#.#','###','..#','..#'],5:['###','#..','##.','..#','##.']}
  for k,tx in enumerate((1,5,9,13,17)):
    px,py=tx*T+2*T-5,13*T+3
    for yy,row in enumerate(DIG[k+1]):
      for xx,ch in enumerate(row):
        if ch=='#': box(px+3+xx,py+2+yy,px+3+xx,py+2+yy,'#2a2135')
  # 가운데 붉은 카펫(계단 → 데스크 → 단상)
  box(11*T+4,3*T+8,13*T+11,12*T-2,CARPET); box(11*T+4,3*T+8,11*T+5,12*T-2,GOLD); box(13*T+10,3*T+8,13*T+11,12*T-2,GOLD)
  box(14*T,12*T+4,21*T+12,12*T+11,CARPET); box(14*T,12*T+4,21*T+12,12*T+5,GOLD); box(14*T,12*T+10,21*T+12,12*T+11,GOLD)
  # 신화 단상(위 가운데, x9~15 y1~3): 금테 계단 단
  box(9*T-4,1*T+2,16*T+3,3*T+10,'#5b3a6e'); box(9*T-4,1*T+2,16*T+3,1*T+4,GOLDL); box(9*T-4,3*T+8,16*T+3,3*T+10,GOLD)
  for x in range(9*T,16*T,6): box(x,3*T+5,x+2,3*T+6,'#7d5a92')
  # 받침대: 돌 기둥 + 금 명판(신화는 금 받침)
  def pedestal(tx,ty,mythic=False):
    x,y=tx*T,ty*T
    box(x+1,y+2,x+T-2,y+T-1,STONED)
    box(x+2,y+2,x+T-3,y+T-3,STONEL if not mythic else GOLDL)
    box(x+3,y+4,x+T-4,y+T-5,STONE if not mythic else GOLD)
    box(x+4,y+T-2,x+T-5,y+T-1,GOLD)
  for tx in (10,12,14): pedestal(tx,2,True)
  for ty in (6,9):
    for tx in (3,6,9,16,19): pedestal(tx,ty)
  # 안내 데스크(가운데 아래, 12,11): 나무 + 방명록
  x,y=12*T,11*T
  box(x-2,y+1,x+T+1,y+T-1,WOOD); box(x-2,y+1,x+T+1,y+3,WOODL); box(x+3,y+6,x+T-4,y+11,'#f3efe4'); box(x+T//2,y+6,x+T//2,y+11,'#9aa3ab')
  # ---- 바깥 벽(1층과 같은 두꺼운 흰 벽, 위쪽 벽 면에 창)
  box(0,0,W-1,T-1,WALLF); box(0,0,W-1,3,WALL)
  for x in range(T*2,W-T*2,T*5):
    box(x,5,x+T*2,T-4,'#9fc4d6'); box(x,5,x+T*2,6,'#e6f4fa')
  box(0,0,T-1,H-1,WALL); box(W-T,0,W-1,H-1,WALL); box(0,H-T,W-1,H-1,WALL); box(0,H-T,W-1,H-T+3,WALLF)
  # 벽 액자(전시관 분위기): 왼쪽·오른쪽 벽
  for ty in (3,8):
    box(2,ty*T,T-3,ty*T+T+4,GOLD); box(4,ty*T+2,T-5,ty*T+T+2,'#6f8fb0')
    box(W-T+2,ty*T,W-3,ty*T+T+4,GOLD); box(W-T+4,ty*T+2,W-5,ty*T+T+2,'#8fae7a')
  # 계단(오른쪽 아래 x22~24 y11~14): 내려가는 단 + 왼쪽 화살표, 난간
  box(22*T,11*T,25*T-1,15*T-1,'#c9c4bb')
  for i in range(8): box(22*T+2,11*T+4+i*7,25*T-3,11*T+6+i*7,'#9f988c')
  box(22*T,11*T,22*T+2,15*T-1,STONED)
  d.line([(24*T+4,13*T+8),(22*T+10,13*T+8)],fill=C('#2a2135'),width=2)
  d.polygon([(22*T+10,13*T+3),(22*T+4,13*T+8),(22*T+10,13*T+13)],fill=C('#2a2135'))
  # 화분(빈 모서리)
  for (x,y) in ((1*T+4,1*T+4),(23*T+4,1*T+4)):
    box(x,y+6,x+8,y+14,WOOD); d.ellipse([x-3,y-4,x+11,y+8],fill=C('#4f7d3a'))
  return im
