package com.siddhamind.config;

import org.springframework.beans.factory.annotation.Value;
import org.springframework.context.annotation.Configuration;
import org.springframework.web.servlet.config.annotation.CorsRegistry;
import org.springframework.web.servlet.config.annotation.InterceptorRegistry;
import org.springframework.web.servlet.config.annotation.WebMvcConfigurer;

@Configuration
public class WebConfig implements WebMvcConfigurer {

    private final AuthInterceptor authInterceptor;

    /**
     * Origins allowed to call {@code /api/**} with credentials.
     *
     * <p>Listed explicitly and never {@code "*"}: a wildcard is rejected outright
     * by browsers once {@code allowCredentials} is set, and the whole point of
     * this API is that it carries the session cookie.
     */
    private final String[] allowedOrigins;

    public WebConfig(AuthInterceptor authInterceptor,
                     @Value("${app.cors.allowed-origins:http://localhost:5173,http://127.0.0.1:5173}")
                     String[] allowedOrigins) {
        this.authInterceptor = authInterceptor;
        this.allowedOrigins = allowedOrigins;
    }

    @Override
    public void addInterceptors(InterceptorRegistry registry) {
        // /error only. The /css, /js and /images excludes were for the static
        // assets of the removed server-rendered UI; nothing serves those paths
        // now, so excluding them would just be a hole in an otherwise
        // deny-by-default filter.
        registry.addInterceptor(authInterceptor)
                .addPathPatterns("/**")
                .excludePathPatterns("/error");
    }

    /**
     * CORS for the React client only.
     *
     * <p>Scoped to {@code /api/**} rather than {@code /**} so that anything added
     * outside the API keeps a same-origin-only posture by default. In development
     * the Vite proxy makes the browser see one origin and none of this is
     * exercised; it is here for the case where the client is served elsewhere.
     */
    @Override
    public void addCorsMappings(CorsRegistry registry) {
        registry.addMapping("/api/**")
                .allowedOrigins(allowedOrigins)
                .allowedMethods("GET", "POST", "PUT", "DELETE", "OPTIONS")
                .allowedHeaders("*")
                .allowCredentials(true)
                .maxAge(3600);
    }
}
