# --- function
scoreboard players add @s[scores={sp1=19,m1=0..,sp1=5..,onground=1,sneak=0},tag=!onSkill] m1 1
execute as @s[scores={sp1=19,sp1=5..,onground=1,sneak=1,cd=0},tag=!onSkill] run tag @s add low
execute as @s[scores={sp1=19,sp1=5..,onground=0,cd=0},tag=!onSkill] run tag @s add high

# --- animation
playanimation @s[scores={sp1=19,m1=1,onground=1,sneak=0},tag=!onSkill] animation.d4c.m1a
playanimation @s[scores={sp1=19,m1=2,onground=1,sneak=0},tag=!onSkill] animation.d4c.m1b
playanimation @s[scores={sp1=19,m1=3,onground=1,sneak=0},tag=!onSkill] animation.d4c.m1c
playanimation @s[scores={sp1=19,m1=4,onground=1,sneak=0},tag=!onSkill] animation.d4c.m1d
playanimation @s[scores={sp1=19,m1=5,onground=1,sneak=0},tag=!onSkill] animation.d4c.m1c
camerashake add @s[scores={sp1=19,onground=1,sneak=0},tag=!onSkill] 0.1 0.1
camerashake add @s[scores={sp1=17,m1=3,onground=1,sneak=0},tag=!onSkill] 0.2 0.2
camerashake add @s[scores={sp1=-24,m1=5,onground=1,sneak=0},tag=!onSkill] 2 0.2

# --- damage
execute as @s[scores={sp1=19,m1=1,onground=1,sneak=0},tag=!onSkill] run scriptevent xvoid:damage 0 4.5/4 6.1 p=d4c:hits ~~1~ barrage:2/0.5
execute as @s[scores={sp1=19,m1=2,onground=1,sneak=0},tag=!onSkill] run scriptevent xvoid:damage 0 5/6/4 5.2 p=d4c:hits ~~1~ barrage:2/0.5
execute as @s[scores={sp1=19,m1=3,onground=1,sneak=0},tag=!onSkill] run scriptevent xvoid:damage 0 4.5/6/4 7.3 p=d4c:hits ~~1~ barrage:5/2
execute as @s[scores={sp1=19,m1=4,onground=1,sneak=0},tag=!onSkill] run scriptevent xvoid:damage 0 4.5/5/4 5.4 p=d4c:hits ~~1~ heavy:1/1.7
execute as @s[scores={sp1=19,m1=5,onground=1,sneak=0},tag=!onSkill] run scriptevent xvoid:damage 0 5/8/5 11.5 p=d4c:hits ~~1~ barrage:15/1

# --- movement

execute as @s[scores={sp1=19,m1=5,onground=1,sneak=0},tag=!onSkill] rotated ~ 0 run scriptevent apply:knockback 2, 0

#sound
execute as @s[scores={sp1=19,m1=1,onground=1,sneak=0},tag=!onSkill] run playsound xvoid.swing02 @a[r=20]
execute as @s[scores={sp1=19,m1=2,onground=1,sneak=0},tag=!onSkill] run playsound xvoid.swing03 @a[r=20]
execute as @s[scores={sp1=19,m1=3,onground=1,sneak=0},tag=!onSkill] run playsound xvoid.swing04 @a[r=20]
execute as @s[scores={sp1=19,m1=4,onground=1,sneak=0},tag=!onSkill] run playsound xvoid.swing05 @a[r=20]
execute as @s[scores={sp1=19,m1=5,onground=1,sneak=0},tag=!onSkill] run playsound xvoid.swing06 @a[r=20]

execute as @s[scores={sp1=19,m1=1..5,onground=1,sneak=0},tag=!onSkill] run playsound xvoid.hit_M @a[r=20] ~~~ 1 1.3 1
#vtn
execute as @s[scores={sp1=19,m1=1,onground=1,sneak=0},tag=!onSkill] run playsound vtn.atkSS_01 @a[r=20]
execute as @s[scores={sp1=19,m1=2,onground=1,sneak=0},tag=!onSkill] run playsound vtn.atkSS_02 @a[r=20]
execute as @s[scores={sp1=19,m1=3,onground=1,sneak=0},tag=!onSkill] run playsound vtn.atkJS_01 @a[r=20]
execute as @s[scores={sp1=19,m1=4,onground=1,sneak=0},tag=!onSkill] run playsound vtn.atkJS_02 @a[r=20]
execute as @s[scores={sp1=19,m1=5,onground=1,sneak=0},tag=!onSkill] run playsound vtn.atkGM_02 @a[r=20]

scoreboard players set @s[scores={sp1=19,sneak=0,m1=5},tag=!onSkill] sp1 -25
scoreboard players set @s[scores={sneak=0,m1=10..15},tag=!onSkill] sp1 10
scoreboard players set @s[scores={sneak=0,m1=10..15},tag=!onSkill] m1 1