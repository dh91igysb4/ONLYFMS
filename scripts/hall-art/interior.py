from PIL import Image, ImageDraw

def render():
  # 마을회관 1층 실내 배경(위에서 본 픽셀, 16px 타일, 평면 v7). 명예의 전당 액자·박제·텔레포터는 게임이 따로 그린다. build-hall-art.py가 부른다.
  T=16
  TW,TH=42,18
  W,H=TW*T,TH*T
  im=Image.new('RGB',(W,H),(40,33,53))
  d=ImageDraw.Draw(im)
  C=lambda h: tuple(int(h[i:i+2],16) for i in (1,3,5))
  WALL='#efe9df'; WALLF='#d7cfc2'; WALLE='#2a2135'
  CORR='#4a5a75'; CORR2='#536481'
  ROOM='#c4c6c6'; ROOM2='#b8babb'
  GLASS='#bfe3ef'; FROST='#e9f5f8'; STEEL='#9aa3ab'
  WOOD='#8a5a3a'
  def tiles(x0,y0,x1,y1,a,b):
    for ty in range(y0,y1+1):
      for tx in range(x0,x1+1):
        d.rectangle([tx*T,ty*T,tx*T+T-1,ty*T+T-1],fill=C(a if (tx+ty)%2 else b))
  def box(x0,y0,x1,y1,c): d.rectangle([x0,y0,x1,y1],fill=C(c))
  # 바닥: 전체 복도(파란 타일) → 방은 베이지로 덮는다
  tiles(1,1,TW-2,TH-2,CORR,CORR2)
  # 방 배치(타일 좌표, 끝 포함)
  TOP=[(10,1,14,6,'1'),(15,1,34,6,'H')]
  BOT=[(10,11,14,16,'6'),(15,11,19,16,'7'),(20,11,24,16,'8'),(25,11,30,16,'9')]
  for (x0,y0,x1,y1,n) in TOP+BOT: tiles(x0,y0,x1,y1,ROOM,ROOM2)
  # 분리수거실(좁은 칸), 주방(왼쪽 위 구석), 엘리베이터·계단(오른쪽)
  tiles(8,1,9,6,'#cfd6dc','#c3cbd2')

  tiles(38,1,40,6,'#b9c0c7','#aeb6be')
  tiles(38,11,40,16,'#c9c4bb','#bdb7ad')
  # ---- 바깥 벽(두꺼운 흰 벽, 위쪽은 벽 면이 보이게)
  box(0,0,W-1,T-1,WALLF); box(0,0,W-1,3,WALL)
  for x in range(T*3,W-T*3,T*5):   # 위 벽 창
    box(x,5,x+T*2,T-4,'#9fc4d6'); box(x,5,x+T*2,6,'#e6f4fa')
  box(0,0,T-1,H-1,WALL); box(W-T,0,W-1,H-1,WALL); box(0,H-T,W-1,H-1,WALL)
  box(0,H-T,W-1,H-T+3,WALLF)
  # 출입구 두 곳(아래 벽, 유리 양문 + 매트)
  for (tx0,tx1) in ((3,5),(31,33)):
    box(tx0*T,H-T,tx1*T+T-1,H-1,GLASS); d.line([((tx0+tx1+1)*T//2,H-T),((tx0+tx1+1)*T//2,H-1)],fill=C(STEEL),width=2)
    box(tx0*T+4,H-T-10,tx1*T+T-5,H-T-2,'#8a1f24')
    for xx in (tx0*T+2,tx1*T+T-4): box(xx,H-T+3,xx+1,H-4,C(WOOD) and WOOD)
  # ---- 방 유리벽: 스테인리스 기둥 + 유리 + 불투명 띠, 문 칸은 비움
  def glass_h(x0,x1,y,door=None):   # 가로 유리벽(복도와 맞닿은 면), y=픽셀
    box(x0,y-2,x1,y+2,GLASS); box(x0,y-1,x1,y,FROST)
    for x in range(x0,x1+1,T): box(x,y-3,x+1,y+3,STEEL)
    box(x1-1,y-3,x1,y+3,STEEL)
    if door:
      dx0,dx1=door
      box(dx0,y-3,dx1,y+3,C(CORR) and CORR)
      box(dx0,y-3,dx0+1,y+3,STEEL); box(dx1-1,y-3,dx1,y+3,STEEL)
      box(dx0+3,y-1,dx0+4,y+1,WOOD); box(dx1-4,y-1,dx1-3,y+1,WOOD)
  def glass_v(x,y0,y1):
    box(x-2,y0,x+2,y1,GLASS); box(x-1,y0,x,y1,FROST)
    for y in range(y0,y1+1,T): box(x-3,y,x+3,y+1,STEEL)
  # 위 줄: 아래쪽 면이 복도
  for (x0,y0,x1,y1,n) in TOP:
    y=(y1+1)*T
    if n=='1': glass_h(x0*T,(x1+1)*T,y,door=(x0*T+T+4,x0*T+2*T+12))
    glass_v(x0*T,y0*T,(y1+1)*T)
  glass_v(35*T,1*T,7*T)
  # 아래 줄: 위쪽 면이 복도
  for (x0,y0,x1,y1,n) in BOT:
    y=y0*T
    glass_h(x0*T,(x1+1)*T,y,door=(x0*T+T+4,x0*T+2*T+12) if n!='9' else ((x1-1)*T+4,x1*T+12))
    glass_v(x0*T,y0*T,(y1+1)*T)
  glass_v(31*T,11*T,17*T)
  # 동아리실 복도 ↔ 엘리베이터·계단 구역 사이 유리벽(위에서 아래까지) + 가운데 유리 양문
  glass_v(35*T,7*T,17*T)
  DY0,DY1=14*T,16*T+4
  box(35*T-3,DY0,35*T+3,DY1,CORR)
  box(35*T-1,DY0,35*T,DY1,'#d6eef6')                     # 닫힌 유리문(투명)
  box(35*T-3,DY0,35*T+3,DY0+1,STEEL); box(35*T-3,DY1-1,35*T+3,DY1,STEEL); box(35*T-3,(DY0+DY1)//2,35*T+3,(DY0+DY1)//2,STEEL)
  for yy in ((DY0+DY1)//2-6,(DY0+DY1)//2+4): box(35*T-5,yy,35*T-4,yy+3,WOOD); box(35*T+4,yy,35*T+5,yy+3,WOOD)
  # 분리수거실·주방 벽
  box(8*T-3,1*T,8*T+1,7*T,WALLF)   # 자판기 벽감 왼쪽 벽(복도 쪽은 열림)
  # 엘리베이터·계단 쪽 벽(세로 복도 오른쪽)
  box(38*T-3,1*T,38*T+1,7*T,WALLF); box(38*T,7*T-3,41*T,7*T+1,WALLF)
  # 엘리베이터 문은 세로 복도 쪽(왼쪽 벽)에
  box(38*T-4,3*T+4,38*T+2,5*T+4,'#cfd4d9'); d.line([(38*T-1,3*T+4),(38*T-1,5*T+4)],fill=C('#8e959c'),width=1); box(38*T-6,5*T+8,38*T-5,5*T+10,'#f2c14e')
  box(38*T-3,14*T,38*T+1,17*T,WALLF); box(38*T,11*T-3,41*T,11*T+1,WALLF)   # 계단은 왼쪽 위가 열려 있다
  # ---- 가구·표시
  # 자판기 두 대(사진 1): 왼쪽 위 구석, 왼쪽 벽에 붙어 앞면이 오른쪽(로비)을 본다
  for i,(body,face) in enumerate((('#1f4fa3','#2f6fd0'),('#e9ecef','#9fcfe0'))):
    y=1*T+2+i*(T+12)
    box(1*T+1,y,2*T+2,y+T+8,body); box(2*T,y,2*T+2,y+T+8,face)
    for k in range(4):
      box(1*T+4,y+3+k*5,2*T-2,y+4+k*5,('#e9eef5','#d9473f')[k%2] if i==0 else '#c98d4a')
    box(2*T-3,y+T,2*T-1,y+T+6,'#0c1a33' if i==0 else '#5b6168')
  # 벤치(①번 옆 벽감): 나무 벤치가 벽에 붙어 복도를 본다
  box(8*T+2,2*T,9*T+13,2*T+9,'#a0703f'); box(8*T+2,2*T,9*T+13,2*T+2,'#c4925a')
  for xx in (8*T+3,9*T+11): box(xx,2*T+9,xx+1,2*T+12,'#5a3a24')
  box(8*T+2,1*T+4,9*T+13,1*T+8,'#8a5a3a')    # 등받이
  # 스탠딩 테이블: 벤치 아래, 6번 방 왼쪽 유리벽에 붙어 일자로
  box(9*T+2,11*T+2,9*T+13,16*T+12,'#9aa1a7'); box(9*T+2,11*T+2,9*T+4,16*T+12,'#c8ced3')
  # 방 안: 탁자 + 의자(용도 미정이라 빈 휴게실처럼)
  def room_furn(x0,y0,x1,y1):
    cx=(x0+x1+1)*T//2; cy=(y0+y1+1)*T//2
    box(cx-14,cy-7,cx+14,cy+7,'#a07a55'); box(cx-14,cy-7,cx+14,cy-5,'#c09a72')
    for dx in (-10,0,10):
      box(cx+dx-3,cy-14,cx+dx+3,cy-10,'#5d6b7a'); box(cx+dx-3,cy+10,cx+dx+3,cy+14,'#5d6b7a')

  # ---- 명예의 전당(2~5 합침): 붉은 카펫 + 위 벽 액자·트로피 진열장(자리 표시)
  box(16*T,3*T+4,33*T+15,4*T+12,'#9b2d30'); box(16*T,3*T+4,33*T+15,3*T+6,'#c9a54a'); box(16*T,4*T+10,33*T+15,4*T+12,'#c9a54a')
  # 구역 바닥 표지: 왼쪽 파랑 띠(낚시), 오른쪽 금색 띠(게임)
  box(16*T,5*T+10,23*T+12,5*T+12,'#5f8fb0'); box(25*T,5*T+10,33*T+15,5*T+12,'#c9a54a')
  # ---- 7·8번 방: 긴 탁자 둘(위아래) + 양옆 의자 2개씩, 노트북
  def desk_room(x0,y0,people,laptops):
    out=[]
    for (ty0,ty1) in ((y0+1,y0+2),(y0+4,y0+5)):
      tx,txx=(x0+1)*T+6,(x0+4)*T-6
      box(tx,ty0*T-4,txx,(ty1+1)*T-4,'#d9d4c8'); box(tx,ty0*T-4,txx,ty0*T-2,'#f0ece2')
      for j,cy in enumerate((ty0*T+4,ty1*T+4)):
        for side,cx in ((0,x0*T+7),(1,(x0+4)*T+2)):
          box(cx,cy-2,cx+7,cy+8,'#3d4654'); box(cx+(0 if side==0 else 5),cy-4,cx+(2 if side==0 else 7),cy+10,'#2c333e')
          out.append((side,cx,cy))
    return out
  def laptop(cx,cy,side,glow):
    lx=cx+15 if side==0 else cx-16
    box(lx,cy-1,lx+8,cy+7,'#b9bec4'); 
    sx=lx+7 if side==0 else lx
    box(sx,cy-3,sx+1,cy+9,'#2a2f38'); box(sx+(-2 if side==0 else 2),cy-2,sx+(-1 if side==0 else 3),cy+8,glow)
  NERD=['...kkkkkkkk...','..kaaaaaaaak..','.kaAaaAaaAaak.','.kaaaaaaaaaak.','.kaaAaaaaAaak.',
  '.ksGGGssGGGsk.','.kGwwGkkGwwGk.','.ksGGGssGGGrk.','.kssrssmmsssk.','..kSssssssSk..','...kSSSSSSk...',
  '..kffqffffqfk.','.kfFqffFffqFk.','kffqqqqqqqqqfk','kFfqFffqFffqFk']
  def dark(h,f=0.62): return '#%02x%02x%02x'%tuple(int(int(h[i:i+2],16)*f) for i in (1,3,5))
  def lite(h): return '#%02x%02x%02x'%tuple(min(255,int(int(h[i:i+2],16)*1.45)+20) for i in (1,3,5))
  NERD_FAT=['....kkkkkkkk....','...kaaaaaaaak...','..kaAaaAaaAaak..','.kaaaaaaaaaaaak.','.kaaAaaaaaaAaak.',
  '.ksGGGssssGGGsk.','.kGwwGkkkkGwwGk.','.ksGGGssssGGGrk.','.kssrsssmmssssk.','kSssssssssssssSk','.kSSssssssssSSk.',
  '..kSSSSSSSSSSk..','.kffqffffffqffk.','kfFqffFffFffqFfk','kffqqqqqqqqqqqfk','kFfqFffqFffqFFfk']
  NOGL={14:['.kssssssssssk.','.kssessssessk.','.kssssssssrsk.'],16:['.kssssssssssssk.','.kssessssssessk.','.ksssssssssssrk.']}
  def nerd(x,y,shirt,hair,plaid=True,headset=False,glasses=True,fat=False):
    rows=list(NERD_FAT if fat else NERD)
    if not glasses: rows[5:8]=NOGL[len(rows[0])]
    pal={'k':'#2a2135','a':hair,'A':lite(hair),'s':'#efc6a0','S':'#d49f7a','G':'#15161b','w':'#dde9f2','r':'#d9574f','m':'#8e5f52','e':'#2a2135',
         'f':shirt,'F':dark(shirt),'q':lite(shirt) if plaid else shirt}
    for yy,row in enumerate(rows):
      for xx,ch in enumerate(row):
        if ch in pal: box(x+xx,y+yy,x+xx,y+yy,pal[ch])
    W=len(rows[0])
    if headset:
      for xx in range(2,W-2): box(x+xx,y,x+xx,y,'#1b1d22')
      box(x,y+4,x+1,y+7,'#1b1d22'); box(x+W-2,y+4,x+W-1,y+7,'#1b1d22'); box(x,y+5,x+1,y+6,'#d23a3a'); box(x+W-2,y+5,x+W-1,y+6,'#d23a3a')
  def can(x,y): box(x,y,x+2,y+4,'#2b2b2b'); box(x,y+1,x+2,y+2,'#8be04a')
  def ramen(x,y): box(x,y,x+4,y+4,'#f4f1ea'); box(x,y,x+4,y+1,'#d23a3a'); box(x+1,y+2,x+3,y+3,'#e9c56a')
  def figure(x,y): box(x+1,y,x+2,y+1,'#f2a6c8'); box(x,y+2,x+3,y+4,'#7fb8f0'); box(x+1,y+5,x+2,y+5,'#2a2135')
  # 8번(들어갈 수 없음): 6명
  seats=desk_room(20,11,6,6)
  looks=[('#8a3b3b','#1a1716',True,False,True,False,'#ff8fc8'),('#2f3f63','#211a16',True,True,False,True,'#ff8fc8'),('#3f5a3a','#141214',True,False,True,False,'#7dff9a'),
         ('#6e7178','#1f1a17',False,True,False,False,'#ff8fc8'),('#4b3f63','#16141a',True,False,True,False,'#7dff9a'),('#7a6a3a','#231c18',True,False,False,True,'#ff8fc8')]
  for (side,cx,cy),(sh,hr,pl,hs,gl,fat,glow) in zip([seats[i] for i in (0,1,2,4,5,7)],looks):
    laptop(cx,cy,side,glow)
    if fat: nerd(cx-4,cy-11,sh,hr,pl,hs,gl,True)
    else: nerd(cx-3,cy-10,sh,hr,pl,hs,gl)
  # 책상 위: 에너지드링크, 컵라면, 피규어
  can(21*T+14,12*T+0); ramen(22*T+6,13*T-2); figure(23*T+2,12*T-1); can(22*T+12,15*T+6); ramen(21*T+12,15*T); can(23*T,16*T-4)
  # 문에 잠금 표시(자물쇠)
  lx,ly=21*T+8,11*T-6
  box(lx,ly,lx+5,ly+5,'#e2b33c'); box(lx+1,ly-3,lx+4,ly-1,'#2a2135'); box(lx+2,ly-2,lx+3,ly-1,'#e2b33c')
  # 7번: 같은 배치, 노트북 두 대(행동하면 게임 탭)
  s7=desk_room(15,11,0,0)
  laptop(s7[0][1],s7[0][2],0,'#ffd36b'); laptop(s7[5][1],s7[5][2],1,'#ffd36b')
  # 6번: 곤의 라면가게(나중에) — 입구에 노렌만
  box(10*T+T+4,11*T+1,10*T+2*T+12,11*T+9,'#c23b2e'); 
  for xx in range(10*T+T+6,10*T+2*T+12,4): box(xx,11*T+9,xx+1,11*T+12,'#c23b2e')

  # 1번 동아리실(사진 2)
  x0,y0=10*T,1*T
  box(x0+T,1,x0+4*T,T-4,'#c79a55'); box(x0+T+3,3,x0+4*T-3,T-6,'#7fae7a')    # 위 벽 큰 나무틀 창(밖은 초록)
  for xx in (x0+2*T,x0+3*T): box(xx-1,3,xx,T-6,'#c79a55')
  for i in range(2):                                                         # 유리문 냉장고 둘(오른쪽 벽)
    fy=y0+2+i*(T+12)
    box(x0+4*T-1,fy,x0+5*T-2,fy+T+8,'#14161c'); box(x0+4*T-1,fy,x0+5*T-2,fy+3,'#2d55c8')
    box(x0+4*T+1,fy+5,x0+5*T-4,fy+T+5,'#cfe6f2')
    for k in range(3): box(x0+4*T+2,fy+8+k*5,x0+5*T-5,fy+8+k*5,'#e2a84a' if k%2 else '#d9473f')
  for i in range(3):                                                         # 스테인리스 분리수거통(왼쪽 벽)
    box(x0+3,y0+4+i*13,x0+T+4,y0+14+i*13,'#a9b1b8'); box(x0+5,y0+6+i*13,x0+T+2,y0+12+i*13,'#3a3f45')
  box(x0+3,y0+5*T+4,x0+T,y0+6*T-2,'#f2f4f5'); box(x0+5,y0+5*T+7,x0+T-2,y0+5*T+9,'#7fb3d6')   # 정수기
    # 작은 탁자
  # 방 번호 팻말(문 옆 유리벽 위, 흰 판에 검은 숫자)
  DIG={'1':['.#.','##.','.#.','.#.','###'],'2':['##.','..#','.#.','#..','###'],'3':['##.','..#','.#.','..#','##.'],
  '4':['#.#','#.#','###','..#','..#'],'5':['###','#..','##.','..#','##.'],'6':['.##','#..','##.','#.#','.#.'],
  '7':['###','..#','.#.','.#.','.#.'],'8':['.#.','#.#','.#.','#.#','.#.'],'9':['.#.','#.#','.##','..#','##.']}
  def plate(x,y,n):
    box(x,y,x+8,y+8,'#f7f7f4'); box(x,y+8,x+8,y+8,'#9aa3ab')
    for yy,row in enumerate(DIG[n]):
      for xx,ch in enumerate(row):
        if ch=='#': d.point((x+3+xx,y+2+yy-1),fill=C('#2a2135')) if False else box(x+3+xx,y+1+yy,x+3+xx,y+1+yy,'#2a2135')
  for (x0,y0,x1,y1,n) in TOP[:1]: plate(x0*T+3*T+2,(y1+1)*T+4,n)
  for (x0,y0,x1,y1,n) in BOT: plate(x0*T+3*T+2 if n!='9' else (x1-2)*T+2,y0*T-13,n)
  # 엘리베이터: 금속 문 두 짝 + 버튼
  box(38*T+6,2*T,40*T+10,6*T+8,'#a9b0b7')   # 엘리베이터 칸 안
  # 계단: 단(왼쪽 위 열린 칸으로 걸어 들어가면 다른 층으로 간다, maps/hall.ts HALL_STAIRS)
  for i in range(9): box(38*T+4+i*5,11*T+6,38*T+6+i*5,16*T+10,'#9f988c')
  # 로비 화분(왼쪽 빈 공간). 가운데 소파는 뺐다(자판기 ↔ 순간이동기 사이를 막지 않게)
  for (x,y) in ((1*T+6,15*T+4),(8*T+4,15*T+4)):
    box(x,y,x+8,y+8,'#8a5a3a'); d.ellipse([x-3,y-10,x+11,y+2],fill=C('#4f7d3a'))
  # ---- 9번: 옷 가게(행거·전신 거울·탈의실)
  X0,Y0=25*T,11*T
  def rack(x,y,n):
    box(x,y,x+n*7+2,y+1,'#9aa3ab'); box(x,y,x+1,y+22,'#7e868d'); box(x+n*7+1,y,x+n*7+2,y+22,'#7e868d'); box(x-2,y+22,x+n*7+4,y+23,'#5d646b')
    cols=['#e85d5d','#f2c14e','#5b8def','#7ccf7a','#f3f1ea','#2f2f36','#c77dd6','#f28ac0','#4fc1c9']
    for i in range(n):
      c=cols[(i*4+x)%len(cols)]; hx=x+3+i*7
      box(hx+1,y+1,hx+2,y+3,'#5d646b'); box(hx-1,y+3,hx+4,y+15,c); box(hx-1,y+3,hx+4,y+4,lite(c))
  rack(X0+8,Y0+16,7); rack(X0+8,Y0+3*T+8,7)
  box(X0+6*T-9,Y0+10,X0+6*T-4,Y0+3*T,'#c9a54a'); box(X0+6*T-8,Y0+12,X0+6*T-5,Y0+3*T-2,'#cfe6f2')   # 전신 거울(오른쪽 벽)
  box(X0+4*T+4,Y0+4*T,X0+6*T-3,Y0+6*T-2,'#7a4a8a')                                                    # 탈의실 커튼
  for xx in range(X0+4*T+6,X0+6*T-4,4): box(xx,Y0+4*T,xx+1,Y0+6*T-2,'#5e3670')
  box(X0+4*T+4,Y0+4*T-2,X0+6*T-3,Y0+4*T-1,'#9aa3ab')

  return im
