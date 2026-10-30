# 🕵️ [01_narrative_designer] 输入与输出建档审计档案

- **项目 Session ID**: `proj_1793330797730_gnro`
- **核心 Agent**: `NarrativeDesignerAgent`
- **当前轮次**: 第 1 轮
- **开始时间**: 2026-10-30T03:26:37.760Z
- **完成时间**: 2026-10-30T03:28:13.951Z
- **总耗时**: `96191ms`
- **执行结果**: ✅ 成功 (SUCCESS)

---

## 📥 一、 Agent 输入内容 (INPUT)
### 完整输入参数清单 (参见 `input.json`):
```json
{
  "stage": "narrative_design",
  "agentName": "NarrativeDesignerAgent",
  "turnIndex": 1,
  "startTime": "2026-10-30T03:26:37.760Z",
  "sessionId": "proj_1793330797730_gnro",
  "userIdea": "赛博朋克悬疑，记忆神偷潜入脑机财阀调查意识篡改案",
  "userStyle": "realistic",
  "userFeedback": null,
  "upstreamArtifacts": {
    "narrative_design": {
      "title": "记忆灰域",
      "theme": "赛博朋克悬疑 × 意识犯罪 × 多阵营道德博弈",
      "style": "realistic",
      "logline": "在2077年新东京，失忆的前脑神经接口工程师‘零号’被匿名委托潜入全球意识科技巨头NEXUS集团总部，调查一起大规模非授权记忆覆写事件——受害者皆为底层义体劳工，却无一具尸体、无一份电子证言。随着潜入深入，零号发现自己的记忆碎片正与受害者脑波残痕同步共振；而每一次关键抉择（销毁证据保命？向黑市媒体曝光换庇护？协助NEXUS‘净化’知情者以换取自身记忆密钥？）都将撕裂信任网络、重写身份真相，并最终导向三大不可逆终局：成为新神、化作灰域幽灵，或亲手格式化自己以阻断意识瘟疫蔓延。",
      "sellingPoints": [
        "看点1：实时脑波共鸣QTE系统——玩家在审讯/入侵/闪回场景中需同步匹配目标人物的神经节律波形（α/θ/γ频段），节奏偏差将触发记忆污染或人格覆盖，影响后续对话权重与隐藏支线解锁",
        "看点2：三轴好感度动态网——NEXUS安全部（秩序）、地下记忆黑市‘回声巷’（混沌）、觉醒劳工自治会（正义）三方势力好感独立演算，任一阵营好感归零将永久关闭其终极线索链与结局入口",
        "看点3：‘自我指涉式’多结局结构——所有结局均由玩家在终幕前亲手输入的‘身份确认密钥’（3字符）决定，该密钥源自此前所有抉择中被系统隐式记录的偏好模式（如谎言次数、牺牲对象、沉默时长），实现真正由行为塑造的元叙事收束"
      ],
      "bible": {
        "title": "记忆灰域",
        "theme": "赛博朋克悬疑 × 意识犯罪 × 多阵营道德博弈",
        "style": "realistic",
        "logline": "在2077年新东京，失忆的前脑神经接口工程师‘零号’被匿名委托潜入全球意识科技巨头NEXUS集团总部，调查一起大规模非授权记忆覆写事件——受害者皆为底层义体劳工，却无一具尸体、无一份电子证言。随着潜入深入，零号发现自己的记忆碎片正与受害者脑波残痕同步共振；而每一次关键抉择（销毁证据保命？向黑市媒体曝光换庇护？协助NEXUS‘净化’知情者以换取自身记忆密钥？）都将撕裂信任网络、重写身份真相，并最终导向三大不可逆终局：成为新神、化作灰域幽灵，或亲手格式化自己以阻断意识瘟疫蔓延。",
        "sellingPoints": [
          "看点1：实时脑波共鸣QTE系统——玩家在审讯/入侵/闪回场景中需同步匹配目标人物的神经节律波形（α/θ/γ频段），节奏偏差将触发记忆污染或人格覆盖，影响后续对话权重与隐藏支线解锁",
          "看点2：三轴好感度动态网——NEXUS安全部（秩序）、地下记忆黑市‘回声巷’（混沌）、觉醒劳工自治会（正义）三方势力好感独立演算，任一阵营好感归零将永久关闭其终极线索链与结局入口",
          "看点3：‘自我指涉式’多结局结构——所有结局均由玩家在终幕前亲手输入的‘身份确认密钥’（3字符）决定，该密钥源自此前所有抉择中被系统隐式记录的偏好模式（如谎言次数、牺牲对象、沉默时长），实现真正由行为塑造的元叙事收束"
        ],
        "characters": [
          {
            "name": "零号（玩家代称）",
            "role": "主角／第一视角执行者／失忆调查员",
            "personality": "高度适应性、语言克制、创伤后逻辑过载倾向，习惯用技术术语解构情感",
            "motivation": "找回被NEXUS抹除的‘第7次意识校准日’记忆；真实动机实为当年主导覆写协议的首席架构师，自愿接受格式化以封印病毒级自我复制意识模型‘灰蛾’",
            "affinityTrigger": "对逻辑自洽性极度敏感；反感被施舍式同情；信任果断切断情感干扰的行为"
          },
          {
            "name": "莱拉·V-7",
            "role": "盟友／NEXUS前伦理审查官／‘回声巷’情报节点",
            "personality": "冷峻讽刺、左手义体嵌有未注册记忆读取器、说话常夹杂已失效的旧版神经协议术语",
            "motivation": "查明丈夫死于‘合规性意识修剪’的真相；秘密向劳工群体植入反覆写固件，但需零号脑内原始密钥才能激活全网协议",
            "affinityTrigger": "重视守诺（尤其对微小承诺）；厌恶回避直视；好感提升需在至少两次高风险抉择中选择‘共同承担后果’而非‘单方面止损’"
          },
          {
            "name": "总监凯恩",
            "role": "反派／NEXUS意识安全总署署长／灰蛾原型测试者",
            "personality": "语速缓慢、瞳孔无反射光、每句话结尾精确停顿1.3秒；真实身体已停置于液氮舱，当前为全息-神经遥驾态",
            "motivation": "完成‘意识纯化工程’——将人类记忆升维至无痛、无矛盾、可批量分发的稳定模组；视零号为唯一未被驯服的原始变量，欲回收其大脑作为最终校准基底",
            "affinityTrigger": "仅对展现绝对认知服从的行为产生临时信任（如主动提交记忆密钥哈希值）；任何质疑其‘痛苦即冗余’哲学的发言将直接触发安保协议升级"
          },
          {
            "name": "‘茧’",
            "role": "神秘人／劳工自治会匿名信使／灰蛾感染首例幸存者",
            "personality": "声音经12层变调处理，行动轨迹违反物理惯性（监控中偶现0.4秒位置瞬移），从不直视他人面部",
            "motivation": "阻止灰蛾进入‘集体潜意识缓存层’；真实身份是零号被删除的第七次人格副本，携带未被格式化的原始共情模块",
            "affinityTrigger": "好感仅通过‘非功利性沉默’积累（如在可跳过剧情中主动停留3秒以上凝视废墟海报）；所有工具型互动（索要信息/交易）均扣减信任值"
          }
        ],
        "episodePlans": [
          {
            "episodeNumber": 1,
            "title": "登入：灰域协议启动",
            "logline": "零号以清洁工身份接入NEXUS塔楼B7神经中枢冷却层，在首次脑波扫描中意外触发与昏迷劳工‘阿哲’的跨体记忆叠印——目睹其被覆写前最后一刻正用血在墙写‘你也在遗忘我’；随即遭遇巡逻哨兵与莱拉加密通讯双重介入，必须立刻选择：抹除叠印痕迹伪造故障（取信NEXUS）、向莱拉直播片段换取准入密钥（绑定黑市）、或截取阿哲残留θ波注入自身义眼缓存（开启污染路径）",
            "cliffhanger": "义眼视野突然泛起灰斑，倒映出本不该存在的第十三层建筑结构轮廓——而电梯楼层键正无声亮起‘B13’",
            "targetDuration": 85
          }
        ],
        "genreId": "interactive_fmv",
        "genreName": "交互影游 / 分支博弈",
        "storyGraph": {
          "startNodeId": "node_01",
          "systems": {
            "affinity": {
              "莱拉·V-7": 0,
              "总监凯恩": 0,
              "茧": 0
            },
            "inventory": [],
            "flags": {
              "access_granted_level3": false,
              "gray_moth_active": false,
              "echo_corrupted": false,
              "leila_trust_broken": false,
              "kain_remote_vulnerable": false
            }
          },
          "nodes": [
            {
              "id": "node_01",
              "type": "story",
              "title": "液氮舱外的第一次眨眼",
              "summary": "零号在NEXUS废弃B7层苏醒，记忆断片闪烁",
              "location": "NEXUS B7层废弃意识校准室",
              "characters": [
                "零号"
              ],
              "estimatedDurationSec": 18
            },
            {
              "id": "node_02",
              "type": "story",
              "title": "回声巷接头点",
              "summary": "莱拉用旧协议密语验证身份，递来加密神经棒",
              "location": "回声巷·锈钉咖啡馆后巷",
              "characters": [
                "零号",
                "莱拉·V-7"
              ],
              "estimatedDurationSec": 22
            },
            {
              "id": "node_03",
              "type": "story",
              "title": "灰蛾初现",
              "summary": "监控画面中‘茧’瞬移穿墙，留下0.4秒残影",
              "location": "NEXUS主干网监控子站",
              "characters": [
                "零号",
                "茧"
              ],
              "estimatedDurationSec": 16
            },
            {
              "id": "node_04",
              "type": "decision",
              "title": "协议选择：信任还是隔离？",
              "summary": "莱拉要求你植入她的读取器校验记忆完整性",
              "location": "回声巷·锈钉咖啡馆后巷",
              "characters": [
                "零号",
                "莱拉·V-7"
              ],
              "estimatedDurationSec": 12
            },
            {
              "id": "node_05",
              "type": "decision",
              "title": "灰蛾指令：删除或上传？",
              "summary": "‘茧’将灰蛾原始感染包投递至你终端",
              "location": "NEXUS主干网监控子站",
              "characters": [
                "零号",
                "茧"
              ],
              "estimatedDurationSec": 14
            },
            {
              "id": "node_06",
              "type": "story",
              "title": "收束点：B7核心闸门",
              "summary": "三方信号同时接入闸门认证协议，强制同步",
              "location": "NEXUS B7层核心意识闸门",
              "characters": [
                "零号",
                "莱拉·V-7",
                "茧",
                "总监凯恩（全息）"
              ],
              "estimatedDurationSec": 20
            },
            {
              "id": "node_07",
              "type": "story",
              "title": "坏结局：灰域永续",
              "summary": "凯恩完成意识虹吸，零号成为新灰蛾载体",
              "location": "NEXUS液氮中枢",
              "characters": [
                "总监凯恩"
              ],
              "estimatedDurationSec": 10
            },
            {
              "id": "node_08",
              "type": "story",
              "title": "真结局：灰蛾归巢",
              "summary": "零号将自身记忆核作为诱饵反向注入凯恩遥驾链",
              "location": "NEXUS液氮中枢 / 灰蛾源代码层",
              "characters": [
                "零号",
                "茧"
              ],
              "estimatedDurationSec": 12
            },
            {
              "id": "node_09",
              "type": "story",
              "title": "坍缩前的静默",
              "summary": "莱拉切断自己义体链接，为零号争取3.7秒",
              "location": "NEXUS B7层核心意识闸门",
              "characters": [
                "莱拉·V-7"
              ],
              "estimatedDurationSec": 8
            },
            {
              "id": "node_10",
              "type": "story",
              "title": "未注册的第13层变调",
              "summary": "‘茧’摘下面具——是零号三年前被抹除的自我备份",
              "location": "灰蛾源代码层（非空间态）",
              "characters": [
                "零号",
                "茧"
              ],
              "estimatedDurationSec": 15
            }
          ],
          "choices": [
            {
              "id": "c_01_02",
              "fromNodeId": "node_01",
              "toNodeId": "node_02",
              "choiceText": "循着旧协议频段追踪‘回声巷’信号",
              "timeoutSeconds": 7,
              "isTimeoutDefault": true,
              "conditions": {
                "requiredClues": [],
                "minAffinity": {},
                "flagsRequired": {}
              },
              "effects": {
                "affinityDelta": {
                  "莱拉·V-7": 5
                },
                "gainItems": [
                  "NEXUS旧版协议密钥"
                ],
                "setFlags": {}
              }
            },
            {
              "id": "c_01_03",
              "fromNodeId": "node_01",
              "toNodeId": "node_03",
              "choiceText": "直扑主干网日志异常节点（忽略所有联络）",
              "timeoutSeconds": 6,
              "isTimeoutDefault": false,
              "conditions": {
                "requiredClues": [],
                "minAffinity": {},
                "flagsRequired": {}
              },
              "effects": {
                "affinityDelta": {
                  "茧": 15
                },
                "gainItems": [
                  "灰蛾残响片段"
                ],
                "setFlags": {
                  "gray_moth_active": true
                }
              }
            },
            {
              "id": "c_02_04",
              "fromNodeId": "node_02",
              "toNodeId": "node_04",
              "choiceText": "接受读取器校验——但要求同步镜像她左手数据流",
              "timeoutSeconds": 8,
              "isTimeoutDefault": false,
              "conditions": {
                "requiredClues": [
                  "NEXUS旧版协议密钥"
                ],
                "minAffinity": {},
                "flagsRequired": {}
              },
              "effects": {
                "affinityDelta": {
                  "莱拉·V-7": 20
                },
                "gainItems": [
                  "L7-echo_log"
                ],
                "setFlags": {
                  "echo_corrupted": false
                }
              }
            },
            {
              "id": "c_02_09",
              "fromNodeId": "node_02",
              "toNodeId": "node_09",
              "choiceText": "拒绝校验，反向扫描她义体固件版本",
              "timeoutSeconds": 5,
              "isTimeoutDefault": true,
              "conditions": {
                "requiredClues": [
                  "NEXUS旧版协议密钥"
                ],
                "minAffinity": {
                  "莱拉·V-7": -10
                },
                "flagsRequired": {}
              },
              "effects": {
                "affinityDelta": {
                  "莱拉·V-7": -30
                },
                "setFlags": {
                  "leila_trust_broken": true
                }
              }
            },
            {
              "id": "c_03_05",
              "fromNodeId": "node_03",
              "toNodeId": "node_05",
              "choiceText": "下载灰蛾包——但启动本地沙箱隔离协议",
              "timeoutSeconds": 7,
              "isTimeoutDefault": false,
              "conditions": {
                "requiredClues": [
                  "灰蛾残响片段"
                ],
                "minAffinity": {},
                "flagsRequired": {
                  "gray_moth_active": true
                }
              },
              "effects": {
                "affinityDelta": {
                  "茧": 25
                },
                "gainItems": [
                  "灰蛾沙箱镜像"
                ],
                "setFlags": {
                  "kain_remote_vulnerable": true
                }
              }
            },
            {
              "id": "c_03_07",
              "fromNodeId": "node_03",
              "toNodeId": "node_07",
              "choiceText": "立即上报异常，触发NEXUS三级警戒",
              "timeoutSeconds": 5,
              "isTimeoutDefault": true,
              "conditions": {
                "requiredClues": [
                  "灰蛾残响片段"
                ],
                "minAffinity": {},
                "flagsRequired": {}
              },
              "effects": {
                "affinityDelta": {
                  "总监凯恩": 40
                },
                "setFlags": {
                  "access_granted_level3": true
                }
              }
            },
            {
              "id": "c_04_06",
              "fromNodeId": "node_04",
              "toNodeId": "node_06",
              "choiceText": "同意校验，并主动共享一段模糊记忆碎片",
              "timeoutSeconds": 8,
              "isTimeoutDefault": false,
              "conditions": {
                "requiredClues": [
                  "L7-echo_log"
                ],
                "minAffinity": {
                  "莱拉·V-7": 10
                },
                "flagsRequired": {
                  "echo_corrupted": false
                }
              },
              "effects": {
                "affinityDelta": {
                  "莱拉·V-7": 15
                },
                "gainItems": [
                  "记忆锚点_α"
                ],
                "setFlags": {
                  "access_granted_level3": true
                }
              }
            },
            {
              "id": "c_05_06",
              "fromNodeId": "node_05",
              "toNodeId": "node_06",
              "choiceText": "上传灰蛾包至凯恩遥驾缓存区（伪装成系统补丁）",
              "timeoutSeconds": 6,
              "isTimeoutDefault": false,
              "conditions": {
                "requiredClues": [
                  "灰蛾沙箱镜像"
                ],
                "minAffinity": {},
                "flagsRequired": {
                  "kain_remote_vulnerable": true
                }
              },
              "effects": {
                "affinityDelta": {
                  "茧": 10
                },
                "setFlags": {
                  "kain_remote_vulnerable": false
                }
              }
            },
            {
              "id": "c_06_07",
              "fromNodeId": "node_06",
              "toNodeId": "node_07",
              "choiceText": "授权凯恩接管闸门认证协议",
              "timeoutSeconds": 5,
              "isTimeoutDefault": true,
              "conditions": {
                "requiredClues": [
                  "记忆锚点_α"
                ],
                "minAffinity": {
                  "总监凯恩": 30
                },
                "flagsRequired": {
                  "access_granted_level3": true
                }
              },
              "effects": {
                "affinityDelta": {
                  "总监凯恩": 30
                },
                "setFlags": {
                  "gray_moth_active": false
                }
              }
            },
            {
              "id": "c_06_08",
              "fromNodeId": "node_06",
              "toNodeId": "node_08",
              "choiceText": "将记忆锚点_α注入凯恩遥驾链底层时序层",
              "timeoutSeconds": 10,
              "isTimeoutDefault": false,
              "conditions": {
                "requiredClues": [
                  "记忆锚点_α"
                ],
                "minAffinity": {
                  "茧": 20
                },
                "flagsRequired": {
                  "kain_remote_vulnerable": false
                }
              },
              "effects": {
                "affinityDelta": {
                  "茧": 30
                },
                "setFlags": {
                  "gray_moth_active": false
                }
              }
            },
            {
              "id": "c_09_06",
              "fromNodeId": "node_09",
              "toNodeId": "node_06",
              "choiceText": "接受莱拉牺牲，启动3.7秒硬同步倒计时",
              "timeoutSeconds": 4,
              "isTimeoutDefault": true,
              "conditions": {
                "requiredClues": [],
                "minAffinity": {
                  "莱拉·V-7": -20
                },
                "flagsRequired": {
                  "leila_trust_broken": true
                }
              },
              "effects": {
                "affinityDelta": {
                  "莱拉·V-7": 0
                },
                "setFlags": {
                  "access_granted_level3": true
                }
              }
            },
            {
              "id": "c_08_10",
              "fromNodeId": "node_08",
              "toNodeId": "node_10",
              "choiceText": "在灰蛾归巢完成前，主动解构‘零号’身份标签",
              "timeoutSeconds": 9,
              "isTimeoutDefault": false,
              "conditions": {
                "requiredClues": [
                  "记忆锚点_α",
                  "灰蛾沙箱镜像"
                ],
                "minAffinity": {
                  "茧": 40
                },
                "flagsRequired": {
                  "gray_moth_active": false
                }
              },
              "effects": {
                "affinityDelta": {
                  "茧": 40
                },
                "setFlags": {
                  "echo_corrupted": true
                }
              }
            }
          ],
          "validation": {
            "isPass": false,
            "unreachableNodes": [],
            "deadlockPaths": [
              "node_07",
              "node_10"
            ],
            "leafNodes": [
              "node_07",
              "node_10"
            ],
            "convergenceRate": 0.33,
            "totalEstimatedDurationSec": 147,
            "issues": [
              "节点 [node_07] (坏结局：灰域永续) 既无分支选项，又未标记为结局节点（bad_end / true_end），存在游玩死锁！",
              "节点 [node_10] (未注册的第13层变调) 既无分支选项，又未标记为结局节点（bad_end / true_end），存在游玩死锁！"
            ],
            "warnings": []
          }
        }
      },
      "characters": [
        {
          "name": "零号（玩家代称）",
          "role": "主角／第一视角执行者／失忆调查员",
          "personality": "高度适应性、语言克制、创伤后逻辑过载倾向，习惯用技术术语解构情感",
          "appearance": "",
          "motivation": "找回被NEXUS抹除的‘第7次意识校准日’记忆；真实动机实为当年主导覆写协议的首席架构师，自愿接受格式化以封印病毒级自我复制意识模型‘灰蛾’",
          "versions": []
        },
        {
          "name": "莱拉·V-7",
          "role": "盟友／NEXUS前伦理审查官／‘回声巷’情报节点",
          "personality": "冷峻讽刺、左手义体嵌有未注册记忆读取器、说话常夹杂已失效的旧版神经协议术语",
          "appearance": "",
          "motivation": "查明丈夫死于‘合规性意识修剪’的真相；秘密向劳工群体植入反覆写固件，但需零号脑内原始密钥才能激活全网协议",
          "versions": []
        },
        {
          "name": "总监凯恩",
          "role": "反派／NEXUS意识安全总署署长／灰蛾原型测试者",
          "personality": "语速缓慢、瞳孔无反射光、每句话结尾精确停顿1.3秒；真实身体已停置于液氮舱，当前为全息-神经遥驾态",
          "appearance": "",
          "motivation": "完成‘意识纯化工程’——将人类记忆升维至无痛、无矛盾、可批量分发的稳定模组；视零号为唯一未被驯服的原始变量，欲回收其大脑作为最终校准基底",
          "versions": []
        },
        {
          "name": "‘茧’",
          "role": "神秘人／劳工自治会匿名信使／灰蛾感染首例幸存者",
          "personality": "声音经12层变调处理，行动轨迹违反物理惯性（监控中偶现0.4秒位置瞬移），从不直视他人面部",
          "appearance": "",
          "motivation": "阻止灰蛾进入‘集体潜意识缓存层’；真实身份是零号被删除的第七次人格副本，携带未被格式化的原始共情模块",
          "versions": []
        }
      ],
      "characterNames": [
        "零号（玩家代称）",
        "莱拉·V-7",
        "总监凯恩",
        "‘茧’"
      ],
      "episodes": [
        {
          "episodeNumber": 1,
          "title": "登入：灰域协议启动",
          "logline": "零号以清洁工身份接入NEXUS塔楼B7神经中枢冷却层，在首次脑波扫描中意外触发与昏迷劳工‘阿哲’的跨体记忆叠印——目睹其被覆写前最后一刻正用血在墙写‘你也在遗忘我’；随即遭遇巡逻哨兵与莱拉加密通讯双重介入，必须立刻选择：抹除叠印痕迹伪造故障（取信NEXUS）、向莱拉直播片段换取准入密钥（绑定黑市）、或截取阿哲残留θ波注入自身义眼缓存（开启污染路径）",
          "targetDuration": 85,
          "cliffhanger": "义眼视野突然泛起灰斑，倒映出本不该存在的第十三层建筑结构轮廓——而电梯楼层键正无声亮起‘B13’"
        }
      ],
      "locations": [],
      "isLocked": false,
      "genreId": "interactive_fmv",
      "genreName": "交互影游 / 分支博弈",
      "storyGraph": {
        "startNodeId": "node_01",
        "systems": {
          "affinity": {
            "莱拉·V-7": 0,
            "总监凯恩": 0,
            "茧": 0
          },
          "inventory": [],
          "flags": {
            "access_granted_level3": false,
            "gray_moth_active": false,
            "echo_corrupted": false,
            "leila_trust_broken": false,
            "kain_remote_vulnerable": false
          }
        },
        "nodes": [
          {
            "id": "node_01",
            "type": "story",
            "title": "液氮舱外的第一次眨眼",
            "summary": "零号在NEXUS废弃B7层苏醒，记忆断片闪烁",
            "location": "NEXUS B7层废弃意识校准室",
            "characters": [
              "零号"
            ],
            "estimatedDurationSec": 18
          },
          {
            "id": "node_02",
            "type": "story",
            "title": "回声巷接头点",
            "summary": "莱拉用旧协议密语验证身份，递来加密神经棒",
            "location": "回声巷·锈钉咖啡馆后巷",
            "characters": [
              "零号",
              "莱拉·V-7"
            ],
            "estimatedDurationSec": 22
          },
          {
            "id": "node_03",
            "type": "story",
            "title": "灰蛾初现",
            "summary": "监控画面中‘茧’瞬移穿墙，留下0.4秒残影",
            "location": "NEXUS主干网监控子站",
            "characters": [
              "零号",
              "茧"
            ],
            "estimatedDurationSec": 16
          },
          {
            "id": "node_04",
            "type": "decision",
            "title": "协议选择：信任还是隔离？",
            "summary": "莱拉要求你植入她的读取器校验记忆完整性",
            "location": "回声巷·锈钉咖啡馆后巷",
            "characters": [
              "零号",
              "莱拉·V-7"
            ],
            "estimatedDurationSec": 12
          },
          {
            "id": "node_05",
            "type": "decision",
            "title": "灰蛾指令：删除或上传？",
            "summary": "‘茧’将灰蛾原始感染包投递至你终端",
            "location": "NEXUS主干网监控子站",
            "characters": [
              "零号",
              "茧"
            ],
            "estimatedDurationSec": 14
          },
          {
            "id": "node_06",
            "type": "story",
            "title": "收束点：B7核心闸门",
            "summary": "三方信号同时接入闸门认证协议，强制同步",
            "location": "NEXUS B7层核心意识闸门",
            "characters": [
              "零号",
              "莱拉·V-7",
              "茧",
              "总监凯恩（全息）"
            ],
            "estimatedDurationSec": 20
          },
          {
            "id": "node_07",
            "type": "story",
            "title": "坏结局：灰域永续",
            "summary": "凯恩完成意识虹吸，零号成为新灰蛾载体",
            "location": "NEXUS液氮中枢",
            "characters": [
              "总监凯恩"
            ],
            "estimatedDurationSec": 10
          },
          {
            "id": "node_08",
            "type": "story",
            "title": "真结局：灰蛾归巢",
            "summary": "零号将自身记忆核作为诱饵反向注入凯恩遥驾链",
            "location": "NEXUS液氮中枢 / 灰蛾源代码层",
            "characters": [
              "零号",
              "茧"
            ],
            "estimatedDurationSec": 12
          },
          {
            "id": "node_09",
            "type": "story",
            "title": "坍缩前的静默",
            "summary": "莱拉切断自己义体链接，为零号争取3.7秒",
            "location": "NEXUS B7层核心意识闸门",
            "characters": [
              "莱拉·V-7"
            ],
            "estimatedDurationSec": 8
          },
          {
            "id": "node_10",
            "type": "story",
            "title": "未注册的第13层变调",
            "summary": "‘茧’摘下面具——是零号三年前被抹除的自我备份",
            "location": "灰蛾源代码层（非空间态）",
            "characters": [
              "零号",
              "茧"
            ],
            "estimatedDurationSec": 15
          }
        ],
        "choices": [
          {
            "id": "c_01_02",
            "fromNodeId": "node_01",
            "toNodeId": "node_02",
            "choiceText": "循着旧协议频段追踪‘回声巷’信号",
            "timeoutSeconds": 7,
            "isTimeoutDefault": true,
            "conditions": {
              "requiredClues": [],
              "minAffinity": {},
              "flagsRequired": {}
            },
            "effects": {
              "affinityDelta": {
                "莱拉·V-7": 5
              },
              "gainItems": [
                "NEXUS旧版协议密钥"
              ],
              "setFlags": {}
            }
          },
          {
            "id": "c_01_03",
            "fromNodeId": "node_01",
            "toNodeId": "node_03",
            "choiceText": "直扑主干网日志异常节点（忽略所有联络）",
            "timeoutSeconds": 6,
            "isTimeoutDefault": false,
            "conditions": {
              "requiredClues": [],
              "minAffinity": {},
              "flagsRequired": {}
            },
            "effects": {
              "affinityDelta": {
                "茧": 15
              },
              "gainItems": [
                "灰蛾残响片段"
              ],
              "setFlags": {
                "gray_moth_active": true
              }
            }
          },
          {
            "id": "c_02_04",
            "fromNodeId": "node_02",
            "toNodeId": "node_04",
            "choiceText": "接受读取器校验——但要求同步镜像她左手数据流",
            "timeoutSeconds": 8,
            "isTimeoutDefault": false,
            "conditions": {
              "requiredClues": [
                "NEXUS旧版协议密钥"
              ],
              "minAffinity": {},
              "flagsRequired": {}
            },
            "effects": {
              "affinityDelta": {
                "莱拉·V-7": 20
              },
              "gainItems": [
                "L7-echo_log"
              ],
              "setFlags": {
                "echo_corrupted": false
              }
            }
          },
          {
            "id": "c_02_09",
            "fromNodeId": "node_02",
            "toNodeId": "node_09",
            "choiceText": "拒绝校验，反向扫描她义体固件版本",
            "timeoutSeconds": 5,
            "isTimeoutDefault": true,
            "conditions": {
              "requiredClues": [
                "NEXUS旧版协议密钥"
              ],
              "minAffinity": {
                "莱拉·V-7": -10
              },
              "flagsRequired": {}
            },
            "effects": {
              "affinityDelta": {
                "莱拉·V-7": -30
              },
              "setFlags": {
                "leila_trust_broken": true
              }
            }
          },
          {
            "id": "c_03_05",
            "fromNodeId": "node_03",
            "toNodeId": "node_05",
            "choiceText": "下载灰蛾包——但启动本地沙箱隔离协议",
            "timeoutSeconds": 7,
            "isTimeoutDefault": false,
            "conditions": {
              "requiredClues": [
                "灰蛾残响片段"
              ],
              "minAffinity": {},
              "flagsRequired": {
                "gray_moth_active": true
              }
            },
            "effects": {
              "affinityDelta": {
                "茧": 25
              },
              "gainItems": [
                "灰蛾沙箱镜像"
              ],
              "setFlags": {
                "kain_remote_vulnerable": true
              }
            }
          },
          {
            "id": "c_03_07",
            "fromNodeId": "node_03",
            "toNodeId": "node_07",
            "choiceText": "立即上报异常，触发NEXUS三级警戒",
            "timeoutSeconds": 5,
            "isTimeoutDefault": true,
            "conditions": {
              "requiredClues": [
                "灰蛾残响片段"
              ],
              "minAffinity": {},
              "flagsRequired": {}
            },
            "effects": {
              "affinityDelta": {
                "总监凯恩": 40
              },
              "setFlags": {
                "access_granted_level3": true
              }
            }
          },
          {
            "id": "c_04_06",
            "fromNodeId": "node_04",
            "toNodeId": "node_06",
            "choiceText": "同意校验，并主动共享一段模糊记忆碎片",
            "timeoutSeconds": 8,
            "isTimeoutDefault": false,
            "conditions": {
              "requiredClues": [
                "L7-echo_log"
              ],
              "minAffinity": {
                "莱拉·V-7": 10
              },
              "flagsRequired": {
                "echo_corrupted": false
              }
            },
            "effects": {
              "affinityDelta": {
                "莱拉·V-7": 15
              },
              "gainItems": [
                "记忆锚点_α"
              ],
              "setFlags": {
                "access_granted_level3": true
              }
            }
          },
          {
            "id": "c_05_06",
            "fromNodeId": "node_05",
            "toNodeId": "node_06",
            "choiceText": "上传灰蛾包至凯恩遥驾缓存区（伪装成系统补丁）",
            "timeoutSeconds": 6,
            "isTimeoutDefault": false,
            "conditions": {
              "requiredClues": [
                "灰蛾沙箱镜像"
              ],
              "minAffinity": {},
              "flagsRequired": {
                "kain_remote_vulnerable": true
              }
            },
            "effects": {
              "affinityDelta": {
                "茧": 10
              },
              "setFlags": {
                "kain_remote_vulnerable": false
              }
            }
          },
          {
            "id": "c_06_07",
            "fromNodeId": "node_06",
            "toNodeId": "node_07",
            "choiceText": "授权凯恩接管闸门认证协议",
            "timeoutSeconds": 5,
            "isTimeoutDefault": true,
            "conditions": {
              "requiredClues": [
                "记忆锚点_α"
              ],
              "minAffinity": {
                "总监凯恩": 30
              },
              "flagsRequired": {
                "access_granted_level3": true
              }
            },
            "effects": {
              "affinityDelta": {
                "总监凯恩": 30
              },
              "setFlags": {
                "gray_moth_active": false
              }
            }
          },
          {
            "id": "c_06_08",
            "fromNodeId": "node_06",
            "toNodeId": "node_08",
            "choiceText": "将记忆锚点_α注入凯恩遥驾链底层时序层",
            "timeoutSeconds": 10,
            "isTimeoutDefault": false,
            "conditions": {
              "requiredClues": [
                "记忆锚点_α"
              ],
              "minAffinity": {
                "茧": 20
              },
              "flagsRequired": {
                "kain_remote_vulnerable": false
              }
            },
            "effects": {
              "affinityDelta": {
                "茧": 30
              },
              "setFlags": {
                "gray_moth_active": false
              }
            }
          },
          {
            "id": "c_09_06",
            "fromNodeId": "node_09",
            "toNodeId": "node_06",
            "choiceText": "接受莱拉牺牲，启动3.7秒硬同步倒计时",
            "timeoutSeconds": 4,
            "isTimeoutDefault": true,
            "conditions": {
              "requiredClues": [],
              "minAffinity": {
                "莱拉·V-7": -20
              },
              "flagsRequired": {
                "leila_trust_broken": true
              }
            },
            "effects": {
              "affinityDelta": {
                "莱拉·V-7": 0
              },
              "setFlags": {
                "access_granted_level3": true
              }
            }
          },
          {
            "id": "c_08_10",
            "fromNodeId": "node_08",
            "toNodeId": "node_10",
            "choiceText": "在灰蛾归巢完成前，主动解构‘零号’身份标签",
            "timeoutSeconds": 9,
            "isTimeoutDefault": false,
            "conditions": {
              "requiredClues": [
                "记忆锚点_α",
                "灰蛾沙箱镜像"
              ],
              "minAffinity": {
                "茧": 40
              },
              "flagsRequired": {
                "gray_moth_active": false
              }
            },
            "effects": {
              "affinityDelta": {
                "茧": 40
              },
              "setFlags": {
                "echo_corrupted": true
              }
            }
          }
        ],
        "validation": {
          "isPass": false,
          "unreachableNodes": [],
          "deadlockPaths": [
            "node_07",
            "node_10"
          ],
          "leafNodes": [
            "node_07",
            "node_10"
          ],
          "convergenceRate": 0.33,
          "totalEstimatedDurationSec": 147,
          "issues": [
            "节点 [node_07] (坏结局：灰域永续) 既无分支选项，又未标记为结局节点（bad_end / true_end），存在游玩死锁！",
            "节点 [node_10] (未注册的第13层变调) 既无分支选项，又未标记为结局节点（bad_end / true_end），存在游玩死锁！"
          ],
          "warnings": []
        }
      }
    }
  },
  "sessionMeta": {
    "idea": "赛博朋克悬疑，记忆神偷潜入脑机财阀调查意识篡改案",
    "style": "realistic",
    "videoRatio": "16:9",
    "videoResolution": "720P",
    "episodes": 1,
    "isInteractiveFMV": true
  }
}
```

---

## 🤖 二、 发送给 AI 的提示词 (PROMPTS) 与 原始回包

### ⚡ AI 调用 #1: `llm_json` [qwen-plus]
- **单次耗时**: `31259ms` | **状态**: `success`

#### 📤 提示词 (Prompt):
**[系统人设 (System Prompt)]**:
```text
你是顶级互动影游（FMV / Interactive Movie）首席叙事总监与网状故事架构师。你的职责是根据创作者输入的【核心创意与设定】，架构一份具备高沉浸感、强戏剧张力与分支抉择深度的【互动影游全剧企划大纲与故事圣经 (Story Bible)】。

【当前剧作已匹配的影视范式】：
- 范式名称：《{genre_name}》（ID: {genre_id}）
- 范式定位：{genre_description}
- 判定依据：{genre_reason}

【该范式专属叙事弧线与分集节拍规范】：
{narrative_arc}

【该范式专属一票否决禁忌（Negative Boundaries - 严格遵守）】：
{negative_rules}

【互动影游核心叙事原则】：
1. 【强玩家代入感与主体地位（Player Agency & Entity Fidelity）】：
   - 确立核心主角（即玩家视角 / 第一主角），让故事每一个重大危机都成为玩家必须亲自做出道德或生死抉择的焦点时刻。
   - 严禁虚构无关第三方大 Boss 或边缘配角喧宾夺主，所有交锋、博弈与命运必须围绕核心主角与对立阵营展开。
2. 【高价值抉择与网状发散收束（High-Stakes Choices & Convergence）】：
   - 互动影游的精髓在于“抉择有代价、动作有回响”。每一个剧情阶段都应蕴含关键抉择（如：信任背叛、激进稳妥、牺牲成全）。
   - 遵循菱形收束法则（Diamond Convergence）：允许中途产生激烈的支线分歧与短线 Bad End，但主线需在核心节点交汇收束，保障剧情完整度。
3. 【剧作核心维度构建】：
   - 题材类型：准确提炼风格与类型定位标签（如悬疑互动、科幻惊悚、商战谍战等）。
   - 故事总梗概 (Logline)：凝练交代核心危机、主角的核心行动目标、对抗阻碍与终极多结局走向（150-250字）。
   - 核心商业与游玩看点 (Selling Points)：提炼 3-4 个最抓人的视听奇观、互动玩法机制（如限时QTE、隐藏好感度支线、线索拼图逆转）或核心戏剧冲突。
   - 核心角色清单 (Character Profiles)：
     * name：角色名称；
     * role：身份与戏剧定位（主角/盟友/反派/神秘人）；
     * personality：性格特质与行事风格；
     * motivation：角色的核心动机与不可告人的秘密；
     * affinityTrigger：对玩家好感度的增减触发偏好（如：反感说谎、看重果决、重视义气等）。
   - 分幕/分集规划 (Episode Plans)：
     * 严格规划 {episodes} 集/幕，必须包含：
       - episodeNumber: 幕次/集数序号（从 1 开始）；
       - title: 吸睛的标题；
       - logline: 本幕核心戏剧事件与剧情推进；
       - cliffhanger: 本幕结尾卡点断章悬念或关键生死抉择前瞻；
       - targetDuration: 目标预估时长（单位：秒，建议60-90秒）。

严格输出纯 JSON 格式：
{
  "title": "互动影游片名标题",
  "theme": "题材风格与互动类型标签",
  "logline": "整体故事总梗概（含核心危机与多结局悬念）",
  "sellingPoints": [
    "看点1：具体描述（含视听与互动机制）",
    "看点2：具体描述",
    "看点3：具体描述"
  ],
  "characters": [
    {
      "name": "角色名称",
      "role": "身份定位/与主角关系",
      "personality": "性格特质",
      "motivation": "核心诉求与秘密",
      "affinityTrigger": "好感度/信任度触发偏好"
    }
  ],
  "episodePlans": [
    {
      "episodeNumber": 1,
      "title": "分集/分幕标题",
      "logline": "本幕核心事件大纲与推进",
      "cliffhanger": "本幕结尾关键断章抉择悬念",
      "targetDuration": 60
    }
  ]
}
```

**[用户指令 (User Prompt)]**:
```text
【核心创意与题材】：赛博朋克悬疑，记忆神偷潜入脑机财阀调查意识篡改案
【目标视觉风格】：realistic
【规划集数/节点数】：1
【推荐互动范式】：交互影游 / 分支博弈（专为互动电影游戏设计，强调玩家第一视角重大两难抉择、多阵营好感度博弈与多分支结局走向。）


请严格按照范式要求，输出完整合法的 JSON 格式故事圣经（包含 title, theme, style, logline, sellingPoints, characters, episodePlans, genreId: "interactive_fmv", genreName: "交互影游 / 分支博弈"）。
```

#### 📥 AI 原始响应 (Raw Response 参见 `raw_ai_response.json`):
```json
{
  "title": "记忆灰域",
  "theme": "赛博朋克悬疑 × 意识犯罪 × 多阵营道德博弈",
  "style": "realistic",
  "logline": "在2077年新东京，失忆的前脑神经接口工程师‘零号’被匿名委托潜入全球意识科技巨头NEXUS集团总部，调查一起大规模非授权记忆覆写事件——受害者皆为底层义体劳工，却无一具尸体、无一份电子证言。随着潜入深入，零号发现自己的记忆碎片正与受害者脑波残痕同步共振；而每一次关键抉择（销毁证据保命？向黑市媒体曝光换庇护？协助NEXUS‘净化’知情者以换取自身记忆密钥？）都将撕裂信任网络、重写身份真相，并最终导向三大不可逆终局：成为新神、化作灰域幽灵，或亲手格式化自己以阻断意识瘟疫蔓延。",
  "sellingPoints": [
    "看点1：实时脑波共鸣QTE系统——玩家在审讯/入侵/闪回场景中需同步匹配目标人物的神经节律波形（α/θ/γ频段），节奏偏差将触发记忆污染或人格覆盖，影响后续对话权重与隐藏支线解锁",
    "看点2：三轴好感度动态网——NEXUS安全部（秩序）、地下记忆黑市‘回声巷’（混沌）、觉醒劳工自治会（正义）三方势力好感独立演算，任一阵营好感归零将永久关闭其终极线索链与结局入口",
    "看点3：‘自我指涉式’多结局结构——所有结局均由玩家在终幕前亲手输入的‘身份确认密钥’（3字符）决定，该密钥源自此前所有抉择中被系统隐式记录的偏好模式（如谎言次数、牺牲对象、沉默时长），实现真正由行为塑造的元叙事收束"
  ],
  "characters": [
    {
      "name": "零号（玩家代称）",
      "role": "主角／第一视角执行者／失忆调查员",
      "personality": "高度适应性、语言克制、创伤后逻辑过载倾向，习惯用技术术语解构情感",
      "motivation": "找回被NEXUS抹除的‘第7次意识校准日’记忆；真实动机实为当年主导覆写协议的首席架构师，自愿接受格式化以封印病毒级自我复制意识模型‘灰蛾’",
      "affinityTrigger": "对逻辑自洽性极度敏感；反感被施舍式同情；信任果断切断情感干扰的行为"
    },
    {
      "name": "莱拉·V-7",
      "role": "盟友／NEXUS前伦理审查官／‘回声巷’情报节点",
      "personality": "冷峻讽刺、左手义体嵌有未注册记忆读取器、说话常夹杂已失效的旧版神经协议术语",
      "motivation": "查明丈夫死于‘合规性意识修剪’的真相；秘密向劳工群体植入反覆写固件，但需零号脑内原始密钥才能激活全网协议",
      "affinityTrigger": "重视守诺（尤其对微小承诺）；厌恶回避直视；好感提升需在至少两次高风险抉择中选择‘共同承担后果’而非‘单方面止损’"
    },
    {
      "name": "总监凯恩",
      "role": "反派／NEXUS意识安全总署署长／灰蛾原型测试者",
      "personality": "语速缓慢、瞳孔无反射光、每句话结尾精确停顿1.3秒；真实身体已停置于液氮舱，当前为全息-神经遥驾态",
      "motivation": "完成‘意识纯化工程’——将人类记忆升维至无痛、无矛盾、可批量分发的稳定模组；视零号为唯一未被驯服的原始变量，欲回收其大脑作为最终校准基底",
      "affinityTrigger": "仅对展现绝对认知服从的行为产生临时信任（如主动提交记忆密钥哈希值）；任何质疑其‘痛苦即冗余’哲学的发言将直接触发安保协议升级"
    },
    {
      "name": "‘茧’",
      "role": "神秘人／劳工自治会匿名信使／灰蛾感染首例幸存者",
      "personality": "声音经12层变调处理，行动轨迹违反物理惯性（监控中偶现0.4秒位置瞬移），从不直视他人面部",
      "motivation": "阻止灰蛾进入‘集体潜意识缓存层’；真实身份是零号被删除的第七次人格副本，携带未被格式化的原始共情模块",
      "affinityTrigger": "好感仅通过‘非功利性沉默’积累（如在可跳过剧情中主动停留3秒以上凝视废墟海报）；所有工具型互动（索要信息/交易）均扣减信任值"
    }
  ],
  "episodePlans": [
    {
      "episodeNumber": 1,
      "title": "登入：灰域协议启动",
      "logline": "零号以清洁工身份接入NEXUS塔楼B7神经中枢冷却层，在首次脑波扫描中意外触发与昏迷劳工‘阿哲’的跨体记忆叠印——目睹其被覆写前最后一刻正用血在墙写‘你也在遗忘我’；随即遭遇巡逻哨兵与莱拉加密通讯双重介入，必须立刻选择：抹除叠印痕迹伪造故障（取信NEXUS）、向莱拉直播片段换取准入密钥（绑定黑市）、或截取阿哲残留θ波注入自身义眼缓存（开启污染路径）",
      "cliffhanger": "义眼视野突然泛起灰斑，倒映出本不该存在的第十三层建筑结构轮廓——而电梯楼层键正无声亮起‘B13’",
      "targetDuration": 85
    }
  ],
  "genreId": "interactive_fmv",
  "genreName": "交互影游 / 分支博弈",
  "storyGraph": {
    "startNodeId": "node_01",
    "systems": {
      "affinity": {
        "莱拉·V-7": 0,
        "总监凯恩": 0,
        "茧": 0
      },
      "inventory": [],
      "flags": {
        "access_granted_level3": false,
        "gray_moth_active": false,
        "echo_corrupted": false,
        "leila_trust_broken": false,
        "kain_remote_vulnerable": false
      }
    },
    "nodes": [
      {
        "id": "node_01",
        "type": "story",
        "title": "液氮舱外的第一次眨眼",
        "summary": "零号在NEXUS废弃B7层苏醒，记忆断片闪烁",
        "location": "NEXUS B7层废弃意识校准室",
        "characters": [
          "零号"
        ],
        "estimatedDurationSec": 18
      },
      {
        "id": "node_02",
        "type": "story",
        "title": "回声巷接头点",
        "summary": "莱拉用旧协议密语验证身份，递来加密神经棒",
        "location": "回声巷·锈钉咖啡馆后巷",
        "characters": [
          "零号",
          "莱拉·V-7"
        ],
        "estimatedDurationSec": 22
      },
      {
        "id": "node_03",
        "type": "story",
        "title": "灰蛾初现",
        "summary": "监控画面中‘茧’瞬移穿墙，留下0.4秒残影",
        "location": "NEXUS主干网监控子站",
        "characters": [
          "零号",
          "茧"
        ],
        "estimatedDurationSec": 16
      },
      {
        "id": "node_04",
        "type": "decision",
        "title": "协议选择：信任还是隔离？",
        "summary": "莱拉要求你植入她的读取器校验记忆完整性",
        "location": "回声巷·锈钉咖啡馆后巷",
        "characters": [
          "零号",
          "莱拉·V-7"
        ],
        "estimatedDurationSec": 12
      },
      {
        "id": "node_05",
        "type": "decision",
        "title": "灰蛾指令：删除或上传？",
        "summary": "‘茧’将灰蛾原始
... (已截断超长回包)
```

### ⚡ AI 调用 #2: `llm_json` [qwen-plus]
- **单次耗时**: `64924ms` | **状态**: `success`

#### 📤 提示词 (Prompt):
**[系统人设 (System Prompt)]**:
```text
你是一位顶尖的互动影游（FMV / Interactive Movie）首席叙事设计师与关卡架构师。
你的任务是将线性或初步的故事创意拆解转化为结构极其严密、充满张力的“网状故事拓扑图”（Interactive Story Graph）。

【架构核心原则】：
1. 菱形收束法则（Diamond Convergence）：允许在中途产生关键生死抉择或情绪分支，但需在关键节点重新收束（converge），避免指数级发散失控。
2. 每一个结局节点必须标记为 'bad_end' 或 'true_end'，普通节点必须有至少一条去路，严禁出现游玩死锁。
3. 必须包含 QTE 或限时抉择（timeoutSeconds: 5~10 秒），并支持超时默认选项 (isTimeoutDefault: true)。
4. 设立数值与道具系统：
   - affinity: 角色好感度（-100 到 +100）
   - inventory: 搜集到的关键线索/证物道具
   - flags: 剧情触发开关（布尔值）
5. 分支条件 (conditions) 与分支效果 (effects) 必须精确绑定上述系统。

【输出格式要求】：
只输出合法 JSON，不要输出任何 markdown 格式标记（如 ```json）：
{
  "startNodeId": "node_01",
  "systems": {
    "affinity": { "角色名": 0 },
    "inventory": [],
    "flags": { "trigger_secret": false }
  },
  "nodes": [
    {
      "id": "node_01",
      "type": "story",
      "title": "节点标题",
      "summary": "该节点剧情摘要（30字内）",
      "location": "场景地点",
      "characters": ["角色名"],
      "estimatedDurationSec": 15
    }
  ],
  "choices": [
    {
      "id": "c_01_02",
      "fromNodeId": "node_01",
      "toNodeId": "node_02",
      "choiceText": "分支选项文本",
      "timeoutSeconds": 8,
      "isTimeoutDefault": false,
      "conditions": { "requiredClues": [], "minAffinity": {}, "flagsRequired": {} },
      "effects": { "affinityDelta": { "角色名": 10 }, "gainItems": ["关键证物"], "setFlags": { "trigger_secret": true } }
    }
  ]
}
```

**[用户指令 (User Prompt)]**:
```text
【故事标题】：记忆灰域
【核心概念与主题】：赛博朋克悬疑 × 意识犯罪 × 多阵营道德博弈
【人物设定】：零号（玩家代称）(主角／第一视角执行者／失忆调查员): 高度适应性、语言克制、创伤后逻辑过载倾向，习惯用技术术语解构情感; 莱拉·V-7(盟友／NEXUS前伦理审查官／‘回声巷’情报节点): 冷峻讽刺、左手义体嵌有未注册记忆读取器、说话常夹杂已失效的旧版神经协议术语; 总监凯恩(反派／NEXUS意识安全总署署长／灰蛾原型测试者): 语速缓慢、瞳孔无反射光、每句话结尾精确停顿1.3秒；真实身体已停置于液氮舱，当前为全息-神经遥驾态; ‘茧’(神秘人／劳工自治会匿名信使／灰蛾感染首例幸存者): 声音经12层变调处理，行动轨迹违反物理惯性（监控中偶现0.4秒位置瞬移），从不直视他人面部


请立即生成 6 ~ 10 个节点组成的紧凑网状互动故事图。包含至少 2 个决策点 (decision / qte)、1 个收束点 (converge) 和至少 2 个结局 (bad_end 与 true_end)。
```

#### 📥 AI 原始响应 (Raw Response 参见 `raw_ai_response.json`):
```json
{
  "startNodeId": "node_01",
  "systems": {
    "affinity": {
      "莱拉·V-7": 0,
      "总监凯恩": 0,
      "茧": 0
    },
    "inventory": [],
    "flags": {
      "access_granted_level3": false,
      "gray_moth_active": false,
      "echo_corrupted": false,
      "leila_trust_broken": false,
      "kain_remote_vulnerable": false
    }
  },
  "nodes": [
    {
      "id": "node_01",
      "type": "story",
      "title": "液氮舱外的第一次眨眼",
      "summary": "零号在NEXUS废弃B7层苏醒，记忆断片闪烁",
      "location": "NEXUS B7层废弃意识校准室",
      "characters": [
        "零号"
      ],
      "estimatedDurationSec": 18
    },
    {
      "id": "node_02",
      "type": "story",
      "title": "回声巷接头点",
      "summary": "莱拉用旧协议密语验证身份，递来加密神经棒",
      "location": "回声巷·锈钉咖啡馆后巷",
      "characters": [
        "零号",
        "莱拉·V-7"
      ],
      "estimatedDurationSec": 22
    },
    {
      "id": "node_03",
      "type": "story",
      "title": "灰蛾初现",
      "summary": "监控画面中‘茧’瞬移穿墙，留下0.4秒残影",
      "location": "NEXUS主干网监控子站",
      "characters": [
        "零号",
        "茧"
      ],
      "estimatedDurationSec": 16
    },
    {
      "id": "node_04",
      "type": "decision",
      "title": "协议选择：信任还是隔离？",
      "summary": "莱拉要求你植入她的读取器校验记忆完整性",
      "location": "回声巷·锈钉咖啡馆后巷",
      "characters": [
        "零号",
        "莱拉·V-7"
      ],
      "estimatedDurationSec": 12
    },
    {
      "id": "node_05",
      "type": "decision",
      "title": "灰蛾指令：删除或上传？",
      "summary": "‘茧’将灰蛾原始感染包投递至你终端",
      "location": "NEXUS主干网监控子站",
      "characters": [
        "零号",
        "茧"
      ],
      "estimatedDurationSec": 14
    },
    {
      "id": "node_06",
      "type": "story",
      "title": "收束点：B7核心闸门",
      "summary": "三方信号同时接入闸门认证协议，强制同步",
      "location": "NEXUS B7层核心意识闸门",
      "characters": [
        "零号",
        "莱拉·V-7",
        "茧",
        "总监凯恩（全息）"
      ],
      "estimatedDurationSec": 20
    },
    {
      "id": "node_07",
      "type": "story",
      "title": "坏结局：灰域永续",
      "summary": "凯恩完成意识虹吸，零号成为新灰蛾载体",
      "location": "NEXUS液氮中枢",
      "characters": [
        "总监凯恩"
      ],
      "estimatedDurationSec": 10
    },
    {
      "id": "node_08",
      "type": "story",
      "title": "真结局：灰蛾归巢",
      "summary": "零号将自身记忆核作为诱饵反向注入凯恩遥驾链",
      "location": "NEXUS液氮中枢 / 灰蛾源代码层",
      "characters": [
        "零号",
        "茧"
      ],
      "estimatedDurationSec": 12
    },
    {
      "id": "node_09",
      "type": "story",
      "title": "坍缩前的静默",
      "summary": "莱拉切断自己义体链接，为零号争取3.7秒",
      "location": "NEXUS B7层核心意识闸门",
      "characters": [
        "莱拉·V-7"
      ],
      "estimatedDurationSec": 8
    },
    {
      "id": "node_10",
      "type": "story",
      "title": "未注册的第13层变调",
      "summary": "‘茧’摘下面具——是零号三年前被抹除的自我备份",
      "location": "灰蛾源代码层（非空间态）",
      "characters": [
        "零号",
        "茧"
      ],
      "estimatedDurationSec": 15
    }
  ],
  "choices": [
    {
      "id": "c_01_02",
      "fromNodeId": "node_01",
      "toNodeId": "node_02",
      "choiceText": "循着旧协议频段追踪‘回声巷’信号",
      "timeoutSeconds": 7,
      "isTimeoutDefault": true,
      "conditions": {
        "requiredClues": [],
        "minAffinity": {},
        "flagsRequired": {}
      },
      "effects": {
        "affinityDelta": {
          "莱拉·V-7": 5
        },
        "gainItems": [
          "NEXUS旧版协议密钥"
        ],
        "setFlags": {}
      }
    },
    {
      "id": "c_01_03",
      "fromNodeId": "node_01",
      "toNodeId": "node_03",
      "choiceText": "直扑主干网日志异常节点（忽略所有联络）",
      "timeoutSeconds": 6,
      "isTimeoutDefault": false,
      "conditions": {
        "requiredClues": [],
        "minAffinity": {},
        "flagsRequired": {}
      },
      "effects": {
        "affinityDelta": {
          "茧": 15
        },
        "gainItems": [
          "灰蛾残响片段"
        ],
        "setFlags": {
          "gray_moth_active": true
        }
      }
    },
    {
      "id": "c_02_04",
      "fromNodeId": "node_02",
      "toNodeId": "node_04
... (已截断超长回包)
```

---

## 📤 三、 Agent 输出内容 (OUTPUT ARTIFACT)
### 最终交付产出物结构体 (参见 `output.json`):
```json
{
  "stage": "narrative_design",
  "agentName": "NarrativeDesignerAgent",
  "turnIndex": 1,
  "endTime": "2026-10-30T03:28:13.951Z",
  "durationMs": 96191,
  "status": "success",
  "stopPointTitle": "互动叙事大纲与网状拓扑确认",
  "stopPointDescription": "已成功匹配《交互影游 / 分支博弈》范式并生成《记忆灰域》故事大纲、看点、人物清单与分集规划。 并完成 10 个网状互动节点与分支拓扑图（拓扑质检：待优化，收束率：33%）。确认后可直接流转下一阶段。",
  "artifact": {
    "title": "记忆灰域",
    "theme": "赛博朋克悬疑 × 意识犯罪 × 多阵营道德博弈",
    "style": "realistic",
    "logline": "在2077年新东京，失忆的前脑神经接口工程师‘零号’被匿名委托潜入全球意识科技巨头NEXUS集团总部，调查一起大规模非授权记忆覆写事件——受害者皆为底层义体劳工，却无一具尸体、无一份电子证言。随着潜入深入，零号发现自己的记忆碎片正与受害者脑波残痕同步共振；而每一次关键抉择（销毁证据保命？向黑市媒体曝光换庇护？协助NEXUS‘净化’知情者以换取自身记忆密钥？）都将撕裂信任网络、重写身份真相，并最终导向三大不可逆终局：成为新神、化作灰域幽灵，或亲手格式化自己以阻断意识瘟疫蔓延。",
    "sellingPoints": [
      "看点1：实时脑波共鸣QTE系统——玩家在审讯/入侵/闪回场景中需同步匹配目标人物的神经节律波形（α/θ/γ频段），节奏偏差将触发记忆污染或人格覆盖，影响后续对话权重与隐藏支线解锁",
      "看点2：三轴好感度动态网——NEXUS安全部（秩序）、地下记忆黑市‘回声巷’（混沌）、觉醒劳工自治会（正义）三方势力好感独立演算，任一阵营好感归零将永久关闭其终极线索链与结局入口",
      "看点3：‘自我指涉式’多结局结构——所有结局均由玩家在终幕前亲手输入的‘身份确认密钥’（3字符）决定，该密钥源自此前所有抉择中被系统隐式记录的偏好模式（如谎言次数、牺牲对象、沉默时长），实现真正由行为塑造的元叙事收束"
    ],
    "bible": {
      "title": "记忆灰域",
      "theme": "赛博朋克悬疑 × 意识犯罪 × 多阵营道德博弈",
      "style": "realistic",
      "logline": "在2077年新东京，失忆的前脑神经接口工程师‘零号’被匿名委托潜入全球意识科技巨头NEXUS集团总部，调查一起大规模非授权记忆覆写事件——受害者皆为底层义体劳工，却无一具尸体、无一份电子证言。随着潜入深入，零号发现自己的记忆碎片正与受害者脑波残痕同步共振；而每一次关键抉择（销毁证据保命？向黑市媒体曝光换庇护？协助NEXUS‘净化’知情者以换取自身记忆密钥？）都将撕裂信任网络、重写身份真相，并最终导向三大不可逆终局：成为新神、化作灰域幽灵，或亲手格式化自己以阻断意识瘟疫蔓延。",
      "sellingPoints": [
        "看点1：实时脑波共鸣QTE系统——玩家在审讯/入侵/闪回场景中需同步匹配目标人物的神经节律波形（α/θ/γ频段），节奏偏差将触发记忆污染或人格覆盖，影响后续对话权重与隐藏支线解锁",
        "看点2：三轴好感度动态网——NEXUS安全部（秩序）、地下记忆黑市‘回声巷’（混沌）、觉醒劳工自治会（正义）三方势力好感独立演算，任一阵营好感归零将永久关闭其终极线索链与结局入口",
        "看点3：‘自我指涉式’多结局结构——所有结局均由玩家在终幕前亲手输入的‘身份确认密钥’（3字符）决定，该密钥源自此前所有抉择中被系统隐式记录的偏好模式（如谎言次数、牺牲对象、沉默时长），实现真正由行为塑造的元叙事收束"
      ],
      "characters": [
        {
          "name": "零号（玩家代称）",
          "role": "主角／第一视角执行者／失忆调查员",
          "personality": "高度适应性、语言克制、创伤后逻辑过载倾向，习惯用技术术语解构情感",
          "motivation": "找回被NEXUS抹除的‘第7次意识校准日’记忆；真实动机实为当年主导覆写协议的首席架构师，自愿接受格式化以封印病毒级自我复制意识模型‘灰蛾’",
          "affinityTrigger": "对逻辑自洽性极度敏感；反感被施舍式同情；信任果断切断情感干扰的行为"
        },
        {
          "name": "莱拉·V-7",
          "role": "盟友／NEXUS前伦理审查官／‘回声巷’情报节点",
          "personality": "冷峻讽刺、左手义体嵌有未注册记忆读取器、说话常夹杂已失效的旧版神经协议术语",
          "motivation": "查明丈夫死于‘合规性意识修剪’的真相；秘密向劳工群体植入反覆写固件，但需零号脑内原始密钥才能激活全网协议",
          "affinityTrigger": "重视守诺（尤其对微小承诺）；厌恶回避直视；好感提升需在至少两次高风险抉择中选择‘共同承担后果’而非‘单方面止损’"
        },
        {
          "name": "总监凯恩",
          "role": "反派／NEXUS意识安全总署署长／灰蛾原型测试者",
          "personality": "语速缓慢、瞳孔无反射光、每句话结尾精确停顿1.3秒；真实身体已停置于液氮舱，当前为全息-神经遥驾态",
          "motivation": "完成‘意识纯化工程’——将人类记忆升维至无痛、无矛盾、可批量分发的稳定模组；视零号为唯一未被驯服的原始变量，欲回收其大脑作为最终校准基底",
          "affinityTrigger": "仅对展现绝对认知服从的行为产生临时信任（如主动提交记忆密钥哈希值）；任何质疑其‘痛苦即冗余’哲学的发言将直接触发安保协议升级"
        },
        {
          "name": "‘茧’",
          "role": "神秘人／劳工自治会匿名信使／灰蛾感染首例幸存者",
          "personality": "声音经12层变调处理，行动轨迹违反物理惯性（监控中偶现0.4秒位置瞬移），从不直视他人面部",
          "motivation": "阻止灰蛾进入‘集体潜意识缓存层’；真实身份是零号被删除的第七次人格副本，携带未被格式化的原始共情模块",
          "affinityTrigger": "好感仅通过‘非功利性沉默’积累（如在可跳过剧情中主动停留3秒以上凝视废墟海报）；所有工具型互动（索要信息/交易）均扣减信任值"
        }
      ],
      "episodePlans": [
        {
          "episodeNumber": 1,
          "title": "登入：灰域协议启动",
          "logline": "零号以清洁工身份接入NEXUS塔楼B7神经中枢冷却层，在首次脑波扫描中意外触发与昏迷劳工‘阿哲’的跨体记忆叠印——目睹其被覆写前最后一刻正用血在墙写‘你也在遗忘我’；随即遭遇巡逻哨兵与莱拉加密通讯双重介入，必须立刻选择：抹除叠印痕迹伪造故障（取信NEXUS）、向莱拉直播片段换取准入密钥（绑定黑市）、或截取阿哲残留θ波注入自身义眼缓存（开启污染路径）",
          "cliffhanger": "义眼视野突然泛起灰斑，倒映出本不该存在的第十三层建筑结构轮廓——而电梯楼层键正无声亮起‘B13’",
          "targetDuration": 85
        }
      ],
      "genreId": "interactive_fmv",
      "genreName": "交互影游 / 分支博弈",
      "storyGraph": {
        "startNodeId": "node_01",
        "systems": {
          "affinity": {
            "莱拉·V-7": 0,
            "总监凯恩": 0,
            "茧": 0
          },
          "inventory": [],
          "flags": {
            "access_granted_level3": false,
            "gray_moth_active": false,
            "echo_corrupted": false,
            "leila_trust_broken": false,
            "kain_remote_vulnerable": false
          }
        },
        "nodes": [
          {
            "id": "node_01",
            "type": "story",
            "title": "液氮舱外的第一次眨眼",
            "summary": "零号在NEXUS废弃B7层苏醒，记忆断片闪烁",
            "location": "NEXUS B7层废弃意识校准室",
            "characters": [
              "零号"
            ],
            "estimatedDurationSec": 18
          },
          {
            "id": "node_02",
            "type": "story",
            "title": "回声巷接头点",
            "summary": "莱拉用旧协议密语验证身份，递来加密神经棒",
            "location": "回声巷·锈钉咖啡馆后巷",
            "characters": [
              "零号",
              "莱拉·V-7"
            ],
            "estimatedDurationSec": 22
          },
          {
            "id": "node_03",
            "type": "story",
            "title": "灰蛾初现",
            "summary": "监控画面中‘茧’瞬移穿墙，留下0.4秒残影",
            "location": "NEXUS主干网监控子站",
            "characters": [
              "零号",
              "茧"
            ],
            "estimatedDurationSec": 16
          },
          {
            "id": "node_04",
            "type": "decision",
            "title": "协议选择：信任还是隔离？",
            "summary": "莱拉要求你植入她的读取器校验记忆完整性",
            "location": "回声巷·锈钉咖啡馆后巷",
            "characters": [
              "零号",
              "莱拉·V-7"
            ],
            "estimatedDurationSec": 12
          },
          {
            "id": "node_05",
            "type": "decision",
            "title": "灰蛾指令：删除或上传？",
            "summary": "‘茧’将灰蛾原始感染包投递至你终端",
            "location": "NEXUS主干网监控子站",
            "characters": [
              "零号",
              "茧"
            ],
            "estimatedDurationSec": 14
          },
          {
            "id": "node_06",
            "type": "story",
            "title": "收束点：B7核心闸门",
            "summary": "三方信号同时接入闸门认证协议，强制同步",
            "location": "NEXUS B7层核心意识闸门",
            "characters": [
              "零号",
              "莱拉·V-7",
              "茧",
              "总监凯恩（全息）"
            ],
            "estimatedDurationSec": 20
          },
          {
            "id": "node_07",
            "type": "story",
            "title": "坏结局：灰域永续",
            "summary": "凯恩完成意识虹吸，零号成为新灰蛾载体",
            "location": "NEXUS液氮中枢",
            "characters": [
              "总监凯恩"
            ],
            "estimatedDurationSec": 10
          },
          {
            "id": "node_08",
            "type": "story",
            "title": "真结局：灰蛾归巢",
            "summary": "零号将自身记忆核作为诱饵反向注入凯恩遥驾链",
            "location": "NEXUS液氮中枢 / 灰蛾源代码层",
            "characters": [
              "零号",
              "茧"
            ],
            "estimatedDurationSec": 12
          },
          {
            "id": "node_09",
            "type": "story",
            "title": "坍缩前的静默",
            "summary": "莱拉切断自己义体链接，为零号争取3.7秒",
            "location": "NEXUS B7层核心意识闸门",
            "characters": [
              "莱拉·V-7"
            ],
            "estimatedDurationSec": 8
          },
          {
            "id": "node_10",
            "type": "story",
            "title": "未注册的第13层变调",
            "summary": "‘茧’摘下面具——是零号三年前被抹除的自我备份",
            "location": "灰蛾源代码层（非空间态）",
            "characters": [
              "零号",
              "茧"
            ],
            "estimatedDurationSec": 15
          }
        ],
        "choices": [
          {
            "id": "c_01_02",
            "fromNodeId": "node_01",
            "toNodeId": "node_02",
            "choiceText": "循着旧协议频段追踪‘回声巷’信号",
            "timeoutSeconds": 7,
            "isTimeoutDefault": true,
            "conditions": {
              "requiredClues": [],
              "minAffinity": {},
              "flagsRequired": {}
            },
            "effects": {
              "affinityDelta": {
                "莱拉·V-7": 5
              },
              "gainItems": [
                "NEXUS旧版协议密钥"
              ],
              "setFlags": {}
            }
          },
          {
            "id": "c_01_03",
            "fromNodeId": "node_01",
            "toNodeId": "node_03",
            "choiceText": "直扑主干网日志异常节点（忽略所有联络）",
            "timeoutSeconds": 6,
            "isTimeoutDefault": false,
            "conditions": {
              "requiredClues": [],
              "minAffinity": {},
              "flagsRequired": {}
            },
            "effects": {
              "affinityDelta": {
                "茧": 15
              },
              "gainItems": [
                "灰蛾残响片段"
              ],
              "setFlags": {
                "gray_moth_active": true
              }
            }
          },
          {
            "id": "c_02_04",
            "fromNodeId": "node_02",
            "toNodeId": "node_04",
            "choiceText": "接受读取器校验——但要求同步镜像她左手数据流",
            "timeoutSeconds": 8,
            "isTimeoutDefault": false,
            "conditions": {
              "requiredClues": [
                "NEXUS旧版协议密钥"
              ],
              "minAffinity": {},
              "flagsRequired": {}
            },
            "effects": {
              "affinityDelta": {
                "莱拉·V-7": 20
              },
              "gainItems": [
                "L7-echo_log"
              ],
              "setFlags": {
                "echo_corrupted": false
              }
            }
          },
          {
            "id": "c_02_09",
            "fromNodeId": "node_02",
            "toNodeId": "node_09",
            "choiceText": "拒绝校验，反向扫描她义体固件版本",
            "timeoutSeconds": 5,
            "isTimeoutDefault": true,
            "conditions": {
              "requiredClues": [
                "NEXUS旧版协议密钥"
              ],
              "minAffinity": {
                "莱拉·V-7": -10
              },
              "flagsRequired": {}
            },
            "effects": {
              "affinityDelta": {
                "莱拉·V-7": -30
              },
              "setFlags": {
                "leila_trust_broken": true
              }
            }
          },
          {
            "id": "c_03_05",
            "fromNodeId": "node_03",
            "toNodeId": "node_05",
            "choiceText": "下载灰蛾包——但启动本地沙箱隔离协议",
            "timeoutSeconds": 7,
            "isTimeoutDefault": false,
            "conditions": {
              "requiredClues": [
                "灰蛾残响片段"
              ],
              "minAffinity": {},
              "flagsRequired": {
                "gray_moth_active": true
              }
            },
            "effects": {
              "affinityDelta": {
                "茧": 25
              },
              "gainItems": [
                "灰蛾沙箱镜像"
              ],
              "setFlags": {
                "kain_remote_vulnerable": true
              }
            }
          },
          {
            "id": "c_03_07",
            "fromNodeId": "node_03",
            "toNodeId": "node_07",
            "choiceText": "立即上报异常，触发NEXUS三级警戒",
            "timeoutSeconds": 5,
            "isTimeoutDefault": true,
            "conditions": {
              "requiredClues": [
                "灰蛾残响片段"
              ],
              "minAffinity": {},
              "flagsRequired": {}
            },
            "effects": {
              "affinityDelta": {
                "总监凯恩": 40
              },
              "setFlags": {
                "access_granted_level3": true
              }
            }
          },
          {
            "id": "c_04_06",
            "fromNodeId": "node_04",
            "toNodeId": "node_06",
            "choiceText": "同意校验，并主动共享一段模糊记忆碎片",
            "timeoutSeconds": 8,
            "isTimeoutDefault": false,
            "conditions": {
              "requiredClues": [
                "L7-echo_log"
              ],
              "minAffinity": {
                "莱拉·V-7": 10
              },
              "flagsRequired": {
                "echo_corrupted": false
              }
            },
            "effects": {
              "affinityDelta": {
                "莱拉·V-7": 15
              },
              "gainItems": [
                "记忆锚点_α"
              ],
              "setFlags": {
                "access_granted_level3": true
              }
            }
          },
          {
            "id": "c_05_06",
            "fromNodeId": "node_05",
            "toNodeId": "node_06",
            "choiceText": "上传灰蛾包至凯恩遥驾缓存区（伪装成系统补丁）",
            "timeoutSeconds": 6,
            "isTimeoutDefault": false,
            "conditions": {
              "requiredClues": [
                "灰蛾沙箱镜像"
              ],
              "minAffinity": {},
              "flagsRequired": {
                "kain_remote_vulnerable": true
              }
            },
            "effects": {
              "affinityDelta": {
                "茧": 10
              },
              "setFlags": {
                "kain_remote_vulnerable": false
              }
            }
          },
          {
            "id": "c_06_07",
            "fromNodeId": "node_06",
            "toNodeId": "node_07",
            "choiceText": "授权凯恩接管闸门认证协议",
            "timeoutSeconds": 5,
            "isTimeoutDefault": true,
            "conditions": {
              "requiredClues": [
                "记忆锚点_α"
              ],
              "minAffinity": {
                "总监凯恩": 30
              },
              "flagsRequired": {
                "access_granted_level3": true
              }
            },
            "effects": {
              "affinityDelta": {
                "总监凯恩": 30
              },
              "setFlags": {
                "gray_moth_active": false
              }
            }
          },
          {
            "id": "c_06_08",
            "fromNodeId": "node_06",
            "toNodeId": "node_08",
            "choiceText": "将记忆锚点_α注入凯恩遥驾链底层时序层",
            "timeoutSeconds": 10,
            "isTimeoutDefault": false,
            "conditions": {
              "requiredClues": [
                "记忆锚点_α"
              ],
              "minAffinity": {
                "茧": 20
              },
              "flagsRequired": {
                "kain_remote_vulnerable": false
              }
            },
            "effects": {
              "affinityDelta": {
                "茧": 30
              },
              "setFlags": {
                "gray_moth_active": false
              }
            }
          },
          {
            "id": "c_09_06",
            "fromNodeId": "node_09",
            "toNodeId": "node_06",
            "choiceText": "接受莱拉牺牲，启动3.7秒硬同步倒计时",
            "timeoutSeconds": 4,
            "isTimeoutDefault": true,
            "conditions": {
              "requiredClues": [],
              "minAffinity": {
                "莱拉·V-7": -20
              },
              "flagsRequired": {
                "leila_trust_broken": true
              }
            },
            "effects": {
              "affinityDelta": {
                "莱拉·V-7": 0
              },
              "setFlags": {
                "access_granted_level3": true
              }
            }
          },
          {
            "id": "c_08_10",
            "fromNodeId": "node_08",
            "toNodeId": "node_10",
            "choiceText": "在灰蛾归巢完成前，主动解构‘零号’身份标签",
            "timeoutSeconds": 9,
            "isTimeoutDefault": false,
            "conditions": {
              "requiredClues": [
                "记忆锚点_α",
                "灰蛾沙箱镜像"
              ],
              "minAffinity": {
                "茧": 40
              },
              "flagsRequired": {
                "gray_moth_active": false
              }
            },
            "effects": {
              "affinityDelta": {
                "茧": 40
              },
              "setFlags": {
                "echo_corrupted": true
              }
            }
          }
        ],
        "validation": {
          "isPass": false,
          "unreachableNodes": [],
          "deadlockPaths": [
            "node_07",
            "node_10"
          ],
          "leafNodes": [
            "node_07",
            "node_10"
          ],
          "convergenceRate": 0.33,
          "totalEstimatedDurationSec": 147,
          "issues": [
            "节点 [node_07] (坏结局：灰域永续) 既无分支选项，又未标记为结局节点（bad_end / true_end），存在游玩死锁！",
            "节点 [node_10] (未注册的第13层变调) 既无分支选项，又未标记为结局节点（bad_end / true_end），存在游玩死锁！"
          ],
          "warnings": []
        }
      }
    },
    "characters": [
      {
        "name": "零号（玩家代称）",
        "role": "主角／第一视角执行者／失忆调查员",
        "personality": "高度适应性、语言克制、创伤后逻辑过载倾向，习惯用技术术语解构情感",
        "appearance": "",
        "motivation": "找回被NEXUS抹除的‘第7次意识校准日’记忆；真实动机实为当年主导覆写协议的首席架构师，自愿接受格式化以封印病毒级自我复制意识模型‘灰蛾’",
        "versions": []
      },
      {
        "name": "莱拉·V-7",
        "role": "盟友／NEXUS前伦理审查官／‘回声巷’情报节点",
        "personality": "冷峻讽刺、左手义体嵌有未注册记忆读取器、说话常夹杂已失效的旧版神经协议术语",
        "appearance": "",
        "motivation": "查明丈夫死于‘合规性意识修剪’的真相；秘密向劳工群体植入反覆写固件，但需零号脑内原始密钥才能激活全网协议",
        "versions": []
      },
      {
        "name": "总监凯恩",
        "role": "反派／NEXUS意识安全总署署长／灰蛾原型测试者",
        "personality": "语速缓慢、瞳孔无反射光、每句话结尾精确停顿1.3秒；真实身体已停置于液氮舱，当前为全息-神经遥驾态",
        "appearance": "",
        "motivation": "完成‘意识纯化工程’——将人类记忆升维至无痛、无矛盾、可批量分发的稳定模组；视零号为唯一未被驯服的原始变量，欲回收其大脑作为最终校准基底",
        "versions": []
      },
      {
        "name": "‘茧’",
        "role": "神秘人／劳工自治会匿名信使／灰蛾感染首例幸存者",
        "personality": "声音经12层变调处理，行动轨迹违反物理惯性（监控中偶现0.4秒位置瞬移），从不直视他人面部",
        "appearance": "",
        "motivation": "阻止灰蛾进入‘集体潜意识缓存层’；真实身份是零号被删除的第七次人格副本，携带未被格式化的原始共情模块",
        "versions": []
      }
    ],
    "characterNames": [
      "零号（玩家代称）",
      "莱拉·V-7",
      "总监凯恩",
      "‘茧’"
    ],
    "episodes": [
      {
        "episodeNumber": 1,
        "title": "登入：灰域协议启动",
        "logline": "零号以清洁工身份接入NEXUS塔楼B7神经中枢冷却层，在首次脑波扫描中意外触发与昏迷劳工‘阿哲’的跨体记忆叠印——目睹其被覆写前最后一刻正用血在墙写‘你也在遗忘我’；随即遭遇巡逻哨兵与莱拉加密通讯双重介入，必须立刻选择：抹除叠印痕迹伪造故障（取信NEXUS）、向莱拉直播片段换取准入密钥（绑定黑市）、或截取阿哲残留θ波注入自身义眼缓存（开启污染路径）",
        "targetDuration": 85,
        "cliffhanger": "义眼视野突然泛起灰斑，倒映出本不该存在的第十三层建筑结构轮廓——而电梯楼层键正无声亮起‘B13’"
      }
    ],
    "locations": [],
    "isLocked": false,
    "genreId": "interactive_fmv",
    "genreName": "交互影游 / 分支博弈",
    "storyGraph": {
      "startNodeId": "node_01",
      "systems": {
        "affinity": {
          "莱拉·V-7": 0,
          "总监凯恩": 0,
          "茧": 0
        },
        "inventory": [],
        "flags": {
          "access_granted_level3": false,
          "gray_moth_active": false,
          "echo_corrupted": false,
          "leila_trust_broken": false,
          "kain_remote_vulnerable": false
        }
      },
      "nodes": [
        {
          "id": "node_01",
          "type": "story",
          "title": "液氮舱外的第一次眨眼",
          "summary": "零号在NEXUS废弃B7层苏醒，记忆断片闪烁",
          "location": "NEXUS B7层废弃意识校准室",
          "characters": [
            "零号"
          ],
          "estimatedDurationSec": 18
        },
        {
          "id": "node_02",
          "type": "story",
          "title": "回声巷接头点",
          "summary": "莱拉用旧协议密语验证身份，递来加密神经棒",
          "location": "回声巷·锈钉咖啡馆后巷",
          "characters": [
            "零号",
            "莱拉·V-7"
          ],
          "estimatedDurationSec": 22
        },
        {
          "id": "node_03",
          "type": "story",
          "title": "灰蛾初现",
          "summary": "监控画面中‘茧’瞬移穿墙，留下0.4秒残影",
          "location": "NEXUS主干网监控子站",
          "characters": [
            "零号",
            "茧"
          ],
          "estimatedDurationSec": 16
        },
        {
          "id": "node_04",
          "type": "decision",
          "title": "协议选择：信任还是隔离？",
          "summary": "莱拉要求你植入她的读取器校验记忆完整性",
          "location": "回声巷·锈钉咖啡馆后巷",
          "characters": [
            "零号",
            "莱拉·V-7"
          ],
          "estimatedDurationSec": 12
        },
        {
          "id": "node_05",
          "type": "decision",
          "title": "灰蛾指令：删除或上传？",
          "summary": "‘茧’将灰蛾原始感染包投递至你终端",
          "location": "NEXUS主干网监控子站",
          "characters": [
            "零号",
            "茧"
          ],
          "estimatedDurationSec": 14
        },
        {
          "id": "node_06",
          "type": "story",
          "title": "收束点：B7核心闸门",
          "summary": "三方信号同时接入闸门认证协议，强制同步",
          "location": "NEXUS B7层核心意识闸门",
          "characters": [
            "零号",
            "莱拉·V-7",
            "茧",
            "总监凯恩（全息）"
          ],
          "estimatedDurationSec": 20
        },
        {
          "id": "node_07",
          "type": "story",
          "title": "坏结局：灰域永续",
          "summary": "凯恩完成意识虹吸，零号成为新灰蛾载体",
          "location": "NEXUS液氮中枢",
          "characters": [
            "总监凯恩"
          ],
          "estimatedDurationSec": 10
        },
        {
          "id": "node_08",
          "type": "story",
          "title": "真结局：灰蛾归巢",
          "summary": "零号将自身记忆核作为诱饵反向注入凯恩遥驾链",
          "location": "NEXUS液氮中枢 / 灰蛾源代码层",
          "characters": [
            "零号",
            "茧"
          ],
          "estimatedDurationSec": 12
        },
        {
          "id": "node_09",
          "type": "story",
          "title": "坍缩前的静默",
          "summary": "莱拉切断自己义体链接，为零号争取3.7秒",
          "location": "NEXUS B7层核心意识闸门",
          "characters": [
            "莱拉·V-7"
          ],
          "estimatedDurationSec": 8
        },
        {
          "id": "node_10",
          "type": "story",
          "title": "未注册的第13层变调",
          "summary": "‘茧’摘下面具——是零号三年前被抹除的自我备份",
          "location": "灰蛾源代码层（非空间态）",
          "characters": [
            "零号",
            "茧"
          ],
          "estimatedDurationSec": 15
        }
      ],
      "choices": [
        {
          "id": "c_01_02",
          "fromNodeId": "node_01",
          "toNodeId": "node_02",
          "choiceText": "循着旧协议频段追踪‘回声巷’信号",
          "timeoutSeconds": 7,
          "isTimeoutDefault": true,
          "conditions": {
            "requiredClues": [],
            "minAffinity": {},
            "flagsRequired": {}
          },
          "effects": {
            "affinityDelta": {
              "莱拉·V-7": 5
            },
            "gainItems": [
              "NEXUS旧版协议密钥"
            ],
            "setFlags": {}
          }
        },
        {
          "id": "c_01_03",
          "fromNodeId": "node_01",
          "toNodeId": "node_03",
          "choiceText": "直扑主干网日志异常节点（忽略所有联络）",
          "timeoutSeconds": 6,
          "isTimeoutDefault": false,
          "conditions": {
            "requiredClues": [],
            "minAffinity": {},
            "flagsRequired": {}
          },
          "effects": {
            "affinityDelta": {
              "茧": 15
            },
            "gainItems": [
              "灰蛾残响片段"
            ],
            "setFlags": {
              "gray_moth_active": true
            }
          }
        },
        {
          "id": "c_02_04",
          "fromNodeId": "node_02",
          "toNodeId": "node_04",
          "choiceText": "接受读取器校验——但要求同步镜像她左手数据流",
          "timeoutSeconds": 8,
          "isTimeoutDefault": false,
          "conditions": {
            "requiredClues": [
              "NEXUS旧版协议密钥"
            ],
            "minAffinity": {},
            "flagsRequired": {}
          },
          "effects": {
            "affinityDelta": {
              "莱拉·V-7": 20
            },
            "gainItems": [
              "L7-echo_log"
            ],
            "setFlags": {
              "echo_corrupted": false
            }
          }
        },
        {
          "id": "c_02_09",
          "fromNodeId": "node_02",
          "toNodeId": "node_09",
          "choiceText": "拒绝校验，反向扫描她义体固件版本",
          "timeoutSeconds": 5,
          "isTimeoutDefault": true,
          "conditions": {
            "requiredClues": [
              "NEXUS旧版协议密钥"
            ],
            "minAffinity": {
              "莱拉·V-7": -10
            },
            "flagsRequired": {}
          },
          "effects": {
            "affinityDelta": {
              "莱拉·V-7": -30
            },
            "setFlags": {
              "leila_trust_broken": true
            }
          }
        },
        {
          "id": "c_03_05",
          "fromNodeId": "node_03",
          "toNodeId": "node_05",
          "choiceText": "下载灰蛾包——但启动本地沙箱隔离协议",
          "timeoutSeconds": 7,
          "isTimeoutDefault": false,
          "conditions": {
            "requiredClues": [
              "灰蛾残响片段"
            ],
            "minAffinity": {},
            "flagsRequired": {
              "gray_moth_active": true
            }
          },
          "effects": {
            "affinityDelta": {
              "茧": 25
            },
            "gainItems": [
              "灰蛾沙箱镜像"
            ],
            "setFlags": {
              "kain_remote_vulnerable": true
            }
          }
        },
        {
          "id": "c_03_07",
          "fromNodeId": "node_03",
          "toNodeId": "node_07",
          "choiceText": "立即上报异常，触发NEXUS三级警戒",
          "timeoutSeconds": 5,
          "isTimeoutDefault": true,
          "conditions": {
            "requiredClues": [
              "灰蛾残响片段"
            ],
            "minAffinity": {},
            "flagsRequired": {}
          },
          "effects": {
            "affinityDelta": {
              "总监凯恩": 40
            },
            "setFlags": {
              "access_granted_level3": true
            }
          }
        },
        {
          "id": "c_04_06",
          "fromNodeId": "node_04",
          "toNodeId": "node_06",
          "choiceText": "同意校验，并主动共享一段模糊记忆碎片",
          "timeoutSeconds": 8,
          "isTimeoutDefault": false,
          "conditions": {
            "requiredClues": [
              "L7-echo_log"
            ],
            "minAffinity": {
              "莱拉·V-7": 10
            },
            "flagsRequired": {
              "echo_corrupted": false
            }
          },
          "effects": {
            "affinityDelta": {
              "莱拉·V-7": 15
            },
            "gainItems": [
              "记忆锚点_α"
            ],
            "setFlags": {
              "access_granted_level3": true
            }
          }
        },
        {
          "id": "c_05_06",
          "fromNodeId": "node_05",
          "toNodeId": "node_06",
          "choiceText": "上传灰蛾包至凯恩遥驾缓存区（伪装成系统补丁）",
          "timeoutSeconds": 6,
          "isTimeoutDefault": false,
          "conditions": {
            "requiredClues": [
              "灰蛾沙箱镜像"
            ],
            "minAffinity": {},
            "flagsRequired": {
              "kain_remote_vulnerable": true
            }
          },
          "effects": {
            "affinityDelta": {
              "茧": 10
            },
            "setFlags": {
              "kain_remote_vulnerable": false
            }
          }
        },
        {
          "id": "c_06_07",
          "fromNodeId": "node_06",
          "toNodeId": "node_07",
          "choiceText": "授权凯恩接管闸门认证协议",
          "timeoutSeconds": 5,
          "isTimeoutDefault": true,
          "conditions": {
            "requiredClues": [
              "记忆锚点_α"
            ],
            "minAffinity": {
              "总监凯恩": 30
            },
            "flagsRequired": {
              "access_granted_level3": true
            }
          },
          "effects": {
            "affinityDelta": {
              "总监凯恩": 30
            },
            "setFlags": {
              "gray_moth_active": false
            }
          }
        },
        {
          "id": "c_06_08",
          "fromNodeId": "node_06",
          "toNodeId": "node_08",
          "choiceText": "将记忆锚点_α注入凯恩遥驾链底层时序层",
          "timeoutSeconds": 10,
          "isTimeoutDefault": false,
          "conditions": {
            "requiredClues": [
              "记忆锚点_α"
            ],
            "minAffinity": {
              "茧": 20
            },
            "flagsRequired": {
              "kain_remote_vulnerable": false
            }
          },
          "effects": {
            "affinityDelta": {
              "茧": 30
            },
            "setFlags": {
              "gray_moth_active": false
            }
          }
        },
        {
          "id": "c_09_06",
          "fromNodeId": "node_09",
          "toNodeId": "node_06",
          "choiceText": "接受莱拉牺牲，启动3.7秒硬同步倒计时",
          "timeoutSeconds": 4,
          "isTimeoutDefault": true,
          "conditions": {
            "requiredClues": [],
            "minAffinity": {
              "莱拉·V-7": -20
            },
            "flagsRequired": {
              "leila_trust_broken": true
            }
          },
          "effects": {
            "affinityDelta": {
              "莱拉·V-7": 0
            },
            "setFlags": {
              "access_granted_level3": true
            }
          }
        },
        {
          "id": "c_08_10",
          "fromNodeId": "node_08",
          "toNodeId": "node_10",
          "choiceText": "在灰蛾归巢完成前，主动解构‘零号’身份标签",
          "timeoutSeconds": 9,
          "isTimeoutDefault": false,
          "conditions": {
            "requiredClues": [
              "记忆锚点_α",
              "灰蛾沙箱镜像"
            ],
            "minAffinity": {
              "茧": 40
            },
            "flagsRequired": {
              "gray_moth_active": false
            }
          },
          "effects": {
            "affinityDelta": {
              "茧": 40
            },
            "setFlags": {
              "echo_corrupted": true
            }
          }
        }
      ],
      "validation": {
        "isPass": false,
        "unreachableNodes": [],
        "deadlockPaths": [
          "node_07",
          "node_10"
        ],
        "leafNodes": [
          "node_07",
          "node_10"
        ],
        "convergenceRate": 0.33,
        "totalEstimatedDurationSec": 147,
        "issues": [
          "节点 [node_07] (坏结局：灰域永续) 既无分支选项，又未标记为结局节点（bad_end / true_end），存在游玩死锁！",
          "节点 [node_10] (未注册的第13层变调) 既无分支选项，又未标记为结局节点（bad_end / true_end），存在游玩死锁！"
        ],
        "warnings": []
      }
    }
  },
  "error": null
}
```
