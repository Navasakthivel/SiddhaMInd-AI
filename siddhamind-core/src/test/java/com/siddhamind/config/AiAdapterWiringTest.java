package com.siddhamind.config;

import com.siddhamind.service.AiExplanationPort;
import com.siddhamind.service.AiIngestPort;
import com.siddhamind.service.AiQueryPort;
import com.siddhamind.service.HttpAiExplanationAdapter;
import com.siddhamind.service.HttpAiIngestAdapter;
import com.siddhamind.service.HttpAiQueryAdapter;
import com.siddhamind.service.NoOpAiExplanationAdapter;
import com.siddhamind.service.NoOpAiIngestAdapter;
import com.siddhamind.service.NoOpAiQueryAdapter;
import org.junit.jupiter.api.Test;
import org.springframework.boot.autoconfigure.AutoConfigurations;
import org.springframework.boot.autoconfigure.context.ConfigurationPropertiesAutoConfiguration;
import org.springframework.boot.context.properties.EnableConfigurationProperties;
import org.springframework.boot.test.context.runner.ApplicationContextRunner;
import org.springframework.context.annotation.Configuration;

import static org.assertj.core.api.Assertions.assertThat;

/**
 * Which AI beans register, and when.
 *
 * <p>The swap is driven by two conditions that are easy to get subtly wrong and
 * whose failure is silent in opposite directions. If the HTTP adapter fails to
 * register, every explanation quietly disappears and the app looks fine. If it
 * registers when {@code base-url} is blank, every page that asks for an
 * explanation waits for a connection to nowhere and then times out.
 */
class AiAdapterWiringTest {

    @Configuration
    @EnableConfigurationProperties(AiProperties.class)
    static class Props {}

    private final ApplicationContextRunner runner = new ApplicationContextRunner()
            .withConfiguration(AutoConfigurations.of(ConfigurationPropertiesAutoConfiguration.class))
            .withUserConfiguration(Props.class, AiClientConfig.class,
                    NoOpAiExplanationAdapter.class, NoOpAiQueryAdapter.class, NoOpAiIngestAdapter.class,
                    HttpAiExplanationAdapter.class, HttpAiQueryAdapter.class, HttpAiIngestAdapter.class);

    @Test
    void theHttpAdapterTakesOverWhenTheBaseUrlIsSet() {
        runner.withPropertyValues(
                        "siddhamind.ai.base-url=http://localhost:8000",
                        "siddhamind.ai.internal-token=token")
                .run(context -> {
                    assertThat(context).hasSingleBean(AiExplanationPort.class);
                    assertThat(context.getBean(AiExplanationPort.class))
                            .isInstanceOf(HttpAiExplanationAdapter.class);
                    assertThat(context).hasSingleBean(AiQueryPort.class);
                    assertThat(context.getBean(AiQueryPort.class)).isInstanceOf(HttpAiQueryAdapter.class);
                    assertThat(context).hasSingleBean(AiIngestPort.class);
                    assertThat(context.getBean(AiIngestPort.class)).isInstanceOf(HttpAiIngestAdapter.class);
                    // isAvailable() is deliberately NOT asserted here any more. It now
                    // performs a liveness probe against the AI service, so in a wiring
                    // test it would assert whether something happens to be listening on
                    // localhost:8000 rather than which bean registered - and the
                    // isInstanceOf checks above already establish that definitively.
                    // Liveness is covered in HttpAiExplanationAdapterTest and
                    // HttpAiQueryAdapterTest, against a mocked transport.
                });
    }

    @Test
    void theNoOpRemainsWhenTheBaseUrlIsBlank() {
        // AI_SERVICE_URL= (empty). Safety and diagnosis keep working on the
        // deterministic engines alone, with no network calls attempted. Every AI
        // port - explanation, query, ingest - must still resolve to *some* bean:
        // AssistantService and AdminService take AiQueryPort/AiIngestPort as
        // plain (non-optional) constructor arguments, so a missing fallback here
        // means the whole application fails to start, not just a degraded page.
        runner.withPropertyValues("siddhamind.ai.base-url=")
                .run(context -> {
                    assertThat(context).hasSingleBean(AiExplanationPort.class);
                    assertThat(context.getBean(AiExplanationPort.class))
                            .isNotInstanceOf(HttpAiExplanationAdapter.class);
                    assertThat(context.getBean(AiExplanationPort.class).isAvailable()).isFalse();

                    assertThat(context).hasSingleBean(AiQueryPort.class);
                    assertThat(context.getBean(AiQueryPort.class))
                            .isNotInstanceOf(HttpAiQueryAdapter.class);
                    assertThat(context.getBean(AiQueryPort.class).isAvailable()).isFalse();

                    assertThat(context).hasSingleBean(AiIngestPort.class);
                    assertThat(context.getBean(AiIngestPort.class))
                            .isNotInstanceOf(HttpAiIngestAdapter.class);
                    assertThat(context.getBean(AiIngestPort.class).isAvailable()).isFalse();
                });
    }

    @Test
    void whitespaceOnlyBaseUrlCountsAsBlank() {
        runner.withPropertyValues("siddhamind.ai.base-url=   ")
                .run(context -> assertThat(context.getBean(AiExplanationPort.class))
                        .isNotInstanceOf(HttpAiExplanationAdapter.class));
    }

    @Test
    void anUnsetBaseUrlCountsAsBlank() {
        runner.run(context -> assertThat(context.getBean(AiExplanationPort.class))
                .isNotInstanceOf(HttpAiExplanationAdapter.class));
    }

    @Test
    void thereIsNeverMoreThanOnePortOfEachKind() {
        // Every no-op is @ConditionalOnMissingBean; if that ever stopped matching
        // for any of the three, injection would fail at startup with a
        // NoUniqueBeanDefinitionException instead of quietly picking one.
        runner.withPropertyValues("siddhamind.ai.base-url=http://localhost:8000")
                .run(context -> {
                    assertThat(context.getBeanNamesForType(AiExplanationPort.class)).hasSize(1);
                    assertThat(context.getBeanNamesForType(AiQueryPort.class)).hasSize(1);
                    assertThat(context.getBeanNamesForType(AiIngestPort.class)).hasSize(1);
                });
    }

    @Test
    void theConfiguredTimeoutIsBound() {
        runner.withPropertyValues(
                        "siddhamind.ai.base-url=http://localhost:8000",
                        "siddhamind.ai.timeout-seconds=12")
                .run(context -> {
                    AiProperties props = context.getBean(AiProperties.class);
                    assertThat(props.timeout().getSeconds()).isEqualTo(12);
                    assertThat(props.isConfigured()).isTrue();
                });
    }

    @Test
    void aZeroTimeoutIsFloored() {
        // 0 would mean "wait forever" to the request factory, which is the exact
        // failure the explicit timeout exists to prevent.
        AiProperties props = new AiProperties();
        props.setTimeoutSeconds(0);
        assertThat(props.timeout().getSeconds()).isEqualTo(1);
    }
}
