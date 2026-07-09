你是一名资深 Agent 开发工程师。

请使用 Goal 模式完成以下子任务。

【当前子任务】
实现 / 设计 / 编写：【优化ai-chat流式内容渲染】

【任务目标】
本轮只需要完成：
1. `ChatMessage`的内容渲染，支持`Text`、`markdown`。其中`markdown`内容要求渲染为`ClickableCard`卡片形式，仅显示标题内容信息，点击卡片触发打开新窗口展示完整`markdown`内容，新窗口与`ChatComposer`窗口保持水平对齐，两个窗口包裹在`Resizable`组件中，支持用户动态调节展示宽度。新窗口要提供顶部工具栏支持”关闭、最小化、最大化、内容复制“等操作，以及展示文档标题、生成时间戳等信息，同时支持窗口状态记忆，便于用户下次打开时恢复上次的窗口状态。

markdown 内容卡片示例代码：

```tsx
const ARTIFACT_TITLE = 'JWT Token Refresh: Design & Rollout';
function ArtifactCard({onOpen}: {onOpen: () => void}) {
  return (
    <ClickableCard
      label={`Open ${ARTIFACT_TITLE}`}
      onClick={onOpen}
      variant="muted"
      padding={3}
      maxWidth={360}
      style={artifactCard}>
      <HStack gap={3} vAlign="center" width="100%">
        <Icon icon={DocumentTextIcon} size="md" color="secondary" />
        <StackItem size="fill">
          <VStack gap={0}>
            <Text type="label" weight="semibold">
              {ARTIFACT_TITLE}
            </Text>
            <Text type="supporting" color="secondary">
              Document
            </Text>
          </VStack>
        </StackItem>
        <Icon icon={ChevronRightIcon} size="sm" color="secondary" />
      </HStack>
    </ClickableCard>
  );
}
```

新窗口示例代码：

```tsx
// Scrollable artifact body — the formatted document.
function ArtifactBody() {
  return (
    <Section variant="transparent" style={artifactScroll}>
      <VStack gap={2} style={articleBody}>
        <Heading level={1}>{ARTIFACT_TITLE}</Heading>
        <Markdown>{ARTIFACT_CONTENT}</Markdown>
      </VStack>
    </Section>
  );
}

{/* Desktop split-pane: resize handle + artifact panel */}
{isArtifactOpen && (
                <>
                  <ResizeHandle
                    direction="horizontal"
                    resizable={artifactResize.props}
                    isReversed
                    pillPlacement="start"
                    hasDivider
                    label="Resize artifact panel"
                    className="ai-chat-resize-handle"
                  />

                  {/* Toolbar as the card header, body below */}
                  <Card
                    variant="transparent"
                    height="100%"
                    className="ai-chat-artifact-panel"
                    style={artifactPanelWidthVar(artifactResize.size)}>
                    <Toolbar
                      label="Artifact actions"
                      dividers={['bottom']}
                      startContent={
                        <HStack gap={3} vAlign="center">
                          <Icon
                            icon={DocumentTextIcon}
                            size="sm"
                            color="secondary"
                          />
                          <VStack gap={0}>
                            <Text type="label" weight="semibold">
                              {ARTIFACT_TITLE}
                            </Text>
                            <Text type="supporting" color="secondary">
                              {ARTIFACT_SUBTITLE}
                            </Text>
                          </VStack>
                        </HStack>
                      }
                      endContent={
                        <ArtifactActions
                          onClose={() => setIsArtifactOpen(false)}
                        />
                      }
                    />

                    <ArtifactBody />
                  </Card>
                </>
              )}

```

2. `ChatMessage`用户发送的消息如有携带"数据源"时，需使用`Token`组件显示“数据源”名称，如有使用Skill时，需使用`ChatTokenizedText`组件显示“Skill”名称。

参考代码示例：

```tsx
{/* User message: mention + file attachments */}
                    <ChatMessage sender="user">
                      <HStack gap={1} wrap="wrap">
                        <Token label="auth-service.ts" />
                        <Token label="middleware.ts" />
                      </HStack>
                      <ChatMessageBubble
                        metadata={
                          <ChatMessageMetadata
                            timestamp={
                              <Timestamp
                                value="2026-04-29T10:15:00"
                                format="time"
                              />
                            }
                          />
                        }>
                        <ChatTokenizedText tokens={MENTION_TOKENS}>
                          @agent Can you review these auth files? The JWT
                          refresh logic seems broken — tokens expire but the
                          middleware doesn't catch it.
                        </ChatTokenizedText>
                      </ChatMessageBubble>
                    </ChatMessage>
```

3. `ChatMessage` assistant发送的消息支持显示“工具调用”的状态信息，如“3 tool calls”，以及每个工具的名称、当前调用状态、调用结果状态、调用耗时、工具调用构成相关文件名称等。

参考代码示例：
```tsx
<ChatMessage
                      sender="assistant"
                      avatar={<Avatar name="Agent" size="small" />}>
                      <ChatMessageBubble variant="ghost">
                        Looking into the auth files now. Let me read through the
                        code and trace the token refresh flow.
                      </ChatMessageBubble>
                      <ChatToolCalls
                        defaultIsExpanded
                        calls={[
                          {
                            name: 'read',
                            target: 'auth-service.ts',
                            status: 'complete',
                            duration: '45ms',
                          },
                          {
                            name: 'read',
                            target: 'middleware.ts',
                            status: 'complete',
                            duration: '38ms',
                          },
                          {
                            name: 'bash',
                            target: 'grep -rn "refreshToken" src/',
                            status: 'complete',
                            duration: '120ms',
                            node: 'cli:remote-server',
                          },
                        ]}
                      />

                      <ChatMessageBubble variant="ghost">
                        <Markdown density="compact">{`Found the issue. In \`middleware.ts\`, the token validation runs **before** the refresh check. When a token expires, the middleware rejects the request immediately instead of attempting a refresh.

Here's the problematic sequence:

1. Request arrives with an expired access token
2. \`validateToken()\` throws \`TokenExpiredError\`
3. The catch block returns \`401\` — never reaching \`refreshToken()\`

The fix is to catch \`TokenExpiredError\` specifically and attempt a refresh before rejecting:`}</Markdown>
                      </ChatMessageBubble>

                      <ChatMessageBubble variant="ghost">
                        <CodeBlock
                          title="middleware.ts"
                          language="typescript"
                          code={`async function authMiddleware(req: Request) {
  try {
    const decoded = validateToken(req.headers.authorization);
    req.user = decoded;
  } catch (err) {
    if (err instanceof TokenExpiredError) {
      // Attempt silent refresh before rejecting
      const refreshed = await refreshToken(req.cookies.refreshToken);
      if (refreshed) {
        req.user = refreshed.user;
        req.newAccessToken = refreshed.accessToken;
        return next(req);
      }
    }
    return new Response('Unauthorized', { status: 401 });
  }
  return next(req);
}`}
                        />
                      </ChatMessageBubble>

                      <ChatToolCalls
                        calls={[
                          {
                            name: 'edit',
                            target: 'middleware.ts',
                            status: 'complete',
                            duration: '85ms',
                            additions: 8,
                            deletions: 2,
                          },
                        ]}
                      />

                      <ChatMessageMetadata
                        timestamp={
                          <Timestamp
                            value="2026-04-29T10:15:30"
                            format="time"
                          />
                        }
                        footer={
                          <Text type="supporting" color="secondary">
                            Agent
                          </Text>
                        }
                      />
                    </ChatMessage>

```
【`ai-chat`模版完整参考示例】
对照模版`ai-chat`的[`playground`](https://astryx.atmeta.com/playground#code=7V3rcttGlv7Pp-jVJKHkiNQliuOhRTuy7JQ1a9kuS0lmK05ZINEUMQIBLi66hGHV_tk32J_7HvN_HmWeZL5zuhtogABIO1ZszwwrZZFAX06fPvdzutNOYymGvieDpH2_1fIm0zBKxAxPX8nRpsDfk8RJ5KZIbqZSHJ6cvIzCqYwST8ZzMYrCiWhH0hkWOreEeIpew4tNfPsh-8ZfjhI5oR_PnJswTfJvh2GQAIbNlhn1WydOoptrV8beebA1DCO5pVpiJjPRqbxONsVT6bhecN7QkdpZ3TDp4djBlPgdy4iAsH8fBVMFGT3M4aRfxzKOnXNZ-vkoHQz88sNnXlzudiwTx3USxzw-uYmBjdKYp-GFDLxfpMuLyx6G_qHj-3EjfqiltcyDS8wVNbRXDaweh07kNo2P13Zr3xteOFj5sm52O6v_iRwmXhg09NQtrD7HTnThhldNnUwTG9LQlY_8cHjRBKVpY9OXN5Fx4kymTbRl2tj9aA-b-tB7q_2jNEkaEaEaWD2Oho3t6bXV-rHn-OH5plB_iV9kE12oZnZ_8Dyh9FgGaVM_q5m9Z3i3pKdpUsBh6A8ayVe3sPqw1Iq9X4jYNgV_lU-dwPVlwzBZj5IIexwO0wlEEvEh4ZN50femgxBkbF6aFydjJ5LmxwE4ezIIffP7pQOJSV3Ngz8TjWZjjuVlFAavvPOxHi4Ddiyj0MOjeItl7Nbu3haEke8FDOvWlngk_fBKJGMvFleem4zxVYp46ntJZ-oEEOyh7zvTWMYiCYUjYohJH08hJ-hVOgm6CnJXDG5oPOoOGY-XQeJgmkj8dyqjGwEc8rs_4dVYDi-EFwiogeAAimAEyEQc0vsbMXSCdiLcyBsl3RZBnojjF4-Onj15c3zw5zc_Hj0-fSr64pu73wB-9ToKw6RXVCxoQRswloSSnmjvbG-7l-M2IYtXqR59zg8ySE-hn_DCCwg9Hdr54vvnzoTeOxpivJzf1yAQPg4ZHdWAjHx53RM7lfNPvOBH9WybftowU4PCHEqXLJ0DQz7Vw2DMbAQDOUnR6jEmTnTuBSzEoGsjAuPSidY7nXjqDLH1nd0NGyQz4MkwApksBSu8lNEI5PZfhMU0CctDDX35KHRv6kC71mj6ZpcRpWA94t0qDEhk-CoNEohVTdOjMGLiM_AKIm1_E3_iGJQLUrz0HG7R6Zg2TP5-hwegEYdpnIClpgquG02vmjYXyB1ULOLE831edOS5UngJsRDtKg23jgaK0sQZz3EmrsLUBxtJsBaNPPQBnYhSX250xSk9KM3he5fADoB3aMCpj3diP05ufPlAJM45RiLWBpyYOZDSjcXzF5o3J1PPl5HhL7Pkl7RiRvIPTgS0rxMP9ESQTgaY9FcsKAINbCzszwPsxjrtkRDtagS2e2z9hSMIkF-k6Pf7oq2GbYuH4uyzGT2eT6_PRI9b0P7ON4QTF6fKWP7g6M3h04PTN7SavjhrdR2vQ_zRiVhid8YsspluXA_SzAFRESHeb83ztkVAubGh0J4Ye64rg_uLAyiK7rhepEyLnpaD9EbztmKZKjxsZP3jMXB5Af4kkL7NtzYj0XUQvOrUE5_NyiIQuNpgiBtWboEehIGkqed2j4r1V3TJVkWUqx4UFrCjxp23zhTnZQKd1gT9Zrbs-Mnz06MXz9-cvvjPJ89p135Cv9ml46fEvd_CfoX_sCl8B2RLDw70AyDTcwKSRAM0bRNN8IDzzdbPOT28Oj367uDw9M3p0Sm4EdT1px9PBRtJUOIj4AYLeMwqW3whXkFYKTeg3P3k-0fZCEZBi7_9VXw_hdUNSfEXCAFg5qqi6-GL56dYIpHjH_4gXoCQLj151Wq9SCNx8PJInGOAKweKMAVzQzgN8TsWEu1uRCTB0RjsyoOwgpIdw4LoEHu7gtbhDIew8CE9sJyu-B6dfQJiE0pVyOspKBG6ldc6kUAVPfYmE-l6mEK8Ptvb3nl9Jv7-P_9HswXiCtOzgIGtE2khNZaQPA5w7XsuoGGEmflOyTZwDTJg9wwjb0D2ABkKECMB0Z7qQawjrqRCUzz2plNARpp_zM_h50FZ-xB65ySTsAXdVgvIIuEGJocBNWm11KYxJA7xl4iwnDt3BhJCXN65g-EIX2o-2JjecNOI4glY1geOaRb5F3AnJi-gJ6YpI9aLrdZOVxxkiHcgokmYqg3IsWpjvrXbBTI1YJLBXN8AYpNxFF7FeMWPnqieT6IojF6ftb7SottJhmMxIL2KOZM0Aiz2xrw-00vKhwXSA6IOtHdgMbnADAZCm9QHoYALaPticS6ThPAJVJwDYCyQN5h7YiH2AsBbMORcwlMHBl0M5Ob4_867VjNYWASNKciBmcrlwVCUQ28EWvZ9ZeI5CfzRaRKzqUi0ke2V2kC9M4C4K15ARaYKPlBDJL04xmYsQE3DkizxAnpLG6137b4AdYwcz08xLkYYkXsrBggRkKLV6MUKOyCfU1ARbJgIEIGGCOWK1jUeDK5jCSOBFHMCpZ1Oif64-4kzItqjfg4whD5AOYwKL6hgGc1TpX3mcWCpO1M9kOkTBsBdlBJ1Kr5k4ruBcZKMN7EHYBQQpC0n1KbhC6AwZKHGoj5EOUNSZET-ZHWH9AcU_6s4GcoA4jSELsdGKg75tfVrJ_vYX9H-B16cWhTbSoT_KEzPxxjh9dnu9jZogBpqslBNSWbbSMmbfgk0XxV3t6J3GanUX7EKNT52fBASpJsZwHpLeNHCHWL-OAy8JCSThbn9BPIIVDj2tCfy-kxR6Bs9D0YY-TCbYH59_bmAqZJEzgi0TXz_I_Ov6kUCvKv7dDUBoy-Raemlpk28HIawR8GuJA8OYHklwsP4GM6Qb0SiWl4P2Uy7c2f3cxAJ7SGLu687MOhTNLgC7OFVa68rXiFcYMxJ0McQfCsh2oYxRC1EOaJCjnvDdu_uHh6lUVxWz3E6IAUV81Pl0GNniOJjWDCAlWQvRH66CeinN5Cy5OZ14Ypi787C4NBHpAso06Y19MJFEk7ZUqY3YsABBxKyo8g5Z90BOU2yjLkZeoAI1YHBQYYUvBsPcBPWMVii_PJua5QGDFIG9oGCcH2mAZj3hPn6sCfWN2CMisvQc2E8kj2jeFCss9myT3Yqf7HDDPqZ0AD3Z8oOUh9jjVzusqtmPrlNcj4OY_IE83fKZm7HE-vpnOwu9fEgH-P-7KdZPrRYH6YRSaaN9nxT5C922vOfTcetDHYVyMnG49b9tUNs0Vr2UMPXX2Pw8ucEW38tnuRPKDbQn-1T1EB_rwxQzPOuAMVaTUxvX0CCrQgnxwreD6BZwOTtgTMkI_6jD-8GsvqLLzSNVIGeI5n7GFMoh61-HVUrqVpLFs6pW0vFauhD60BotJ-xQ_YuW-uGerbPD-B_zJnhj8MBhF9OyOwdK97KQj6kBhHzQZxGe0UsDiymVIOUWbOK80x0TsOk8ZlZ2Hpmg6MyzgzPZIuzWZT8SuI3Hei1WTHxEp_e_aCkWeEdj9ljJyT_VDPlpkGzETCzOZyP6n47S1v_bImF_OtML8P1LhEriCAI8ldmcOJxDE8UAxe8kk0rejGbZN1ypjFNtYgpkocK6FBIM3dIBwjNsOHCegsqmGw9N2OHCmFNwZxKctBR-ZxtoGqNebYG5YUQRn9WDC7NM8Gi0kHwp6b92S74JW-t40dZUzTWmR3hw4Dy-7Od-YNZ0Vec72_pNlYvkwCwGmv3Ds2zlwagLQWR-r1vUg4FfB4FHcT4KUkDgzoi-wNWBoU_lUFbjEttwXGDOV-BUArckep7gZ5K89G3pXqvkD4psODsjAZAfKGElDMjSCwBw5Pqx9nGTWCWuIZPp45LiOzPvjLtTNAOj-5um4el_eXcT4ZMlfZTu_vVXFwe-PDZ-2swXGE_ralYRH-NzJ41a8MsUVoOuhuJOnHXSLKFESSLxHPXiW5IxuaDZNlF3WMEK96apER62xaZ8UuakKVRf42RC2A5BkvzTTwE893CYMykJbQXB-SkY_0kcTqlTAMQXrGw8kwGK0tmKNKypmeDlmp8l5MPtgZrwDfYrsA1BRotqiqKa1LIEgEpCifBPaIEiytHDrnCOZMcqRRsQMYrhw5O4Yr6MKy1DFIBm594KPjOx0jXwaqVWdaWHvyM-I3JWK-3nfiizSG7XGMiNgNnv8C08MUdgOH7HYRGJNhJ8e99YxOrBjHFgJm_uzksXmxYW2XMiMcYpqOKFwXY4OzGkmFbGKpikIXuSZTavSmFgjiZaoEv-09Pj589QTwGGH-wTiaS1dgsXGXHTB-dAtNxYL07J2wM393jgD3nJejJSyQE9u6ZZ861efbHu_oZxfJPnEt5hDRFuzpcycp8Dqj07mQOWhZK7ago-QDxk4tpCFsGGSoKkMUpuYQqkIBlKxebfpE7RKSV708hQYV4uNLnDKJqoNILfYO_rrYZHnbD0QgbwLJPPHwI-T_y4IzeqPgpfL911XO_v5DcUrTKcrKaDPK9AwKEBBlU91hoSwhjfBW1gxZqcFr7M72OTKvS71w2q9zCzAq-Qx2qh6aJSlBlgkIls7QozZ7qyHDfNuN0T13EkauSBTGrFYQZuaQJtFzdusNFDzo0z1YLBa1VFpOA0WlOB45zgZd9CbKDB75VlMU5mjRi8oRfCT6lcLNU3cI7Yo0gBilALFJOLUwzs9f-WNOogcrwKDwqwVVAZAkMI9wqW5B-P0kHEw97kRmrNS0hSYeSggu189kgkSxVaR6SobXNBbI_7YP4gsIcyEEjKtjtNrWGOEAUnwPQAliJBILcSUOfusV4VKADF2yhaKfkdNkfhO6wdu3lNKAgCzNUvlzwLRc_2juCv0RTVVHHKo5nBU1VuKIVqFlwTu1ihHr_tGKkKo-1_LEMsN-ErYME7Dn-8MgqVGr8nthSDv7bMMEIwn0lgq4Mly1-qgJoNftFSdMqQaHFQZsY_QlYu-Cy125oZRyuekvLkbkKbDVt00IkourTvP48qEgLbYY487-Mi1eyVrWF2jxIKVbxrtCusB3LwSVx_ZvgzQKib8Eb1V0qm1coc61HrZrM6nnI5nhMUXwdwqmwIazhCoWbuWDSfRcMGvM5DV2nWj7AgyoP-4BsvWpAv6fUr45I9Cisxx7Ul2QawRhiUUoPqwyhRZxgmwOyCtYoI1kLesGz35mLqwhf1ujf2i7k7-rEJct4Sq4gc4nE-lB2k7jgvTf3zJOazf2KXmnzslXNbi0AyMdwqW6DYC2OZ2p7G5mDipq4VrRxWIUA03RJQxKjqKzor-1u797tbO91dv94urPd2_m6t73drP2UEqFAICJ4mG1Z60ZdX6-nlnSt5FkLvYVyaF0I0J8Vy1EaxhBC1aaIQ0TCYXPCUSJHkdwGeF5Eksw18UNOo6Nco2GkQt0CJZsnyFdHTKgcWFVFCqr4gNQpTdIwnJWqd0MZU92kKjSATdxgJywgpZ4bFsi9ummhYYPYOUDiHCQJZGayh1J9gJoK06mijyOrlHGEVaDKJVaRQDXwG7mEjKWato5AHS5jhyGn6tlFgEpPmJS07QhHaxMOMLIVt7psKBuc9UT2LAwvuCqGMi7skGZ0RVUYXfFMEs6oFoSCxyoF30QcjECuuY2Mj6vS5XapTh2RrLzvGYfpswW14Ohw0FGMVD-gQjVLLeA0TrOF1Sz5aO9grhCmlpgr2GlUz6jSUVuvLDMjEUBLkTpqkwnry0RVCdd_3BTJfS4UbO99PWkevdH2ee_rLmjF21v1V_dufdUDJ1bV3Sus-jySU9FB_GvNrrkCn0fDrdtDws7u9hIsYDFgWhrc93qRnMA5Y6JENvAdkVdrLEOb3oIQy9JmeYiL8ISw2tqD2dl3KIFRhTdc59VFTBT1MgUSfH2GQ2KZpLJLAKk6yqoBVEVgSpDxaQJU6FBVI2q4uavSoNAolWWBhSKyvFISVVgeYrokYVGGogvZSCg7Zi7Ukj1FWVVbDYBKcKpYBISkyjEYqnBUXeGrj6Sq0KofpHUsFhmq4rGRd02lONA8asC3K_XL0bNQ4tc7q0iXrqRsboM6s-NZDczEFQNld6Ghve8E5ymAgf2LnBwFJqeNcSVSy0i6OvFNMMwzV6R_jrMp10GZPUNDKhuAA0eFtIOLhBqUKBIPRcJBz64KU8ZdGhTFb78wB-kUAL3nqt--GYKLt_W-r6Pm0WQfKEWBn8wRDggbHLFAFHmmgurKNDUsqfrUHXTWSTXihThXDheBWgRK0A7JMJKxKanjF3oxCshsjByawjqz9_zA9FRNUIx4wKyofEW7sWJRfm734bxJAJOZgMvgUGJW_Zu1uaLTY8hZxgh7fB-Y3ZBQzmKWKRLwKiexVO_F8fNE_Fu4RG_NUcvtt_dllXH85-OyTu4ts8ngHiAXpQsj7y0ZV2Jy1XL3wyjtpVGE1SIIK0YP6iIHXy2JHKwaNWhy-2vfqLj2kuW9Yx1F8cMeYtM0FSUcq6yhZtmrutml6B4cL68zUOryHK7jlIyB9xjYW1TKPAtlfaNGlfwc_pbSPWSpIV07cS5gLmHWuM6zfVvXdLVYnYYXB-4atPcnH9C7-zEF9IzMRsxb0kknGBXvKgjqX5mQHWplUMjq0hEnHLpCzZAuWrePTTz8kEEwAkod7YEdzmWXX366MbBPPRxkGx7YmNuNjezeemzkXW2u2176zs7yiIhlee3urWx66SqyjyHYdOPAoGf2zlF7i9TU3f2YYky_d4jpAEe2a2U8B7xx-MpHIGmPm8SIJNGpNj4aR8fpcJaMqiPTOD8Ulx2IW3oc7u___7-Lh9nguXs4l4lzmvlhtuqGHCMqn3wzQR1yE_OO5RNwdis7mqV7_DMEYZQsuoVIjDnOjEqKQhAGXnpe7ekl61AgKjTA51OLh65VyMOnsxkqsLNYJ6o7mDgDyoSxRZoAkDJcnwAjZLXrkILqxLSgT69nnfRvFSGxuln9EDpAc3qng0i6JpfravOYUA-BvkcSa43E689mNoRzBGKzQA3HX3DWoBCboTsOLOC0fNDluDkcdHeHCuwshrhMW0yM0BCexF0l-Ta6SfhIruPEqMZG1kIFdbqeq5uY5dOThabF4I7q8ViiDFe66yriQvGVjfvvLcLyafjmd3t7X38w3_w3-rVaOJuTNKsX2NRBiobBOXmcKPrlg9JXYXTBVcHvvcZGpxv4xGt27M1UHd-mM_7P68_e-_QLVCjvD_ILIUu7uIqLY-VHfOyAbZeXr1AKoX3YqwjFhyLFaZLa0fjeEDp1QtecgMpIHNKtQOa4A6ur4mUdmLFeGlEX6Uw-pGecsQgfm_uXqAVpsnGbXJezo_YlCoFwaQEdy4SYyemAr4MwVKDzlio5itwfXSOjErPKT3Fgs15z_nCKcz_UC_c-OXTaQl0qx4dstOA0d71MkHPqvg5e8yFBdR-AEXLqFirIVl03hdokXKfAe8xXU3AEgK850Ed4HzZo5He0ZGua2scqUbpKsOOgo3XmZ76aF_Mx6PV7vb0PF3N_H_HqEd3bcdWBgPu3NnwHbbi7_S8X3eWLqfAfCnocCJUs2MtxXi1M6O4cOj5ON8JAztRvf3ZXDN3_wrfwBO6HVHxe0IGgxtK4UETXSP5bATYqQFwoBVeTL2ni04Mggzt3qu4DQuDH0Ie5cg0XJkJr8gVAEd2tY3Siw7f1IMwDkwmH32Lcv0Z3wRllmqk5qtL83RTXx5u0Bz7irYKd2Z0sC7xnAU-UeZGt-klFMD8C3Q_R_wHz7avp_iUNqo_VqCbq_Gv5bX5TQcXZX5wR5YP3-T3G5IDzaXV9P-aXpTs3KiTrrHiivnhHUONhz3373uhK7GS3h_bXOCBHZ9atA9L2h-GmlGB-Y4YavktX0cbV2-LFr6j2D7f9Vb7G7a_-SzrPS6IL4pyu-q2efezEj9WZpMrX-niNvgmgiNLqAflWW7pJGZqo6ubSql7VlS-00foCb7phgd0SMuRVAdymuq9GeR_VanPfug6l5qCofS9NNX7sY-irLrh4k0F1t9IlKYWreddLhED_bNSoYpyDYhTVcK85PZvdZVG8iWmRbpkWSKu0ByGOe07ateKTqUqf5286Xdp840vj8WA6MbvC-dyFK2Hew8nfhUqhdz7j3HSpTFPd0qqXzCzwTdOlM29bwfQei6lsyMw9vL8VuMX7bN72xF8dBLCmV6Dt0t1oDZDqC9zMPQyLN3moC1_e5_HXanlhX95VPSjUsr6jZ9kJ9BK4Vbje1_9PFo3M_NXCzYck7_UlPJmi4YgS3-5hXb-jrkqxhP6-emJdDKhCPVW37-QQq4CQShH0ZzWXseTNp2lEB537a14wCituOCQIFYD2xVULt4Qo7VWiKb0AdUtnCccqW7qEqXHZZ7ldHYvVavy3xMcim-AWwIr7AhcuRihQkf2q6tqY1S-OWULatXRow2DdXqWWbG6vyqUMX1v1Dw).


【上下文】
该子任务属于【数据助手】中的一部分，请对照参考示例实现功能。

