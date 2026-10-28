package arch

import com.tngtech.archunit.core.importer.ImportOption
import com.tngtech.archunit.junit.AnalyzeClasses
import com.tngtech.archunit.junit.ArchTest
import com.tngtech.archunit.lang.ArchRule
import com.tngtech.archunit.lang.syntax.ArchRuleDefinition.noClasses

@AnalyzeClasses(packages = ["com.acme.shop"], importOptions = [ImportOption.DoNotIncludeTests::class])
class ArchitectureTest {

    @ArchTest
    val domainNotInfra: ArchRule =
        noClasses().that().resideInAPackage("..domain..")
            .should().dependOnClassesThat().resideInAPackage("..infra..")
            .because("domain stays pure, depend on a port in the domain layer")

    @ArchTest
    val appNotInfra: ArchRule =
        noClasses().that().resideInAPackage("..app..")
            .should().dependOnClassesThat().resideInAPackage("..infra..")
            .because("app may import only: domain")
}
