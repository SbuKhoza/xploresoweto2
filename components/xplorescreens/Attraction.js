import { Text } from "react-native"
import ExploreList from "./shared/ExploreList"
import { DetailTitle, MetaCard, Section, Chips, InfoChip, DirectionsButton } from "./shared/detail"

const fmtPrice = (p) => (p === undefined || p === null || p === "" ? null : Number(p) === 0 ? "Free" : `R${p}`)

const Attraction = () => (
  <ExploreList
    collectionName="attractions"
    title="Attractions"
    subtitle={"Things to see\n& do"}
    sectionTitle="Attractions"
    searchPlaceholder="Search attractions, places, etc…"
    noun={{ one: "attraction", many: "attractions" }}
    emptyIcon="camera"
    fallbackType="All Attractions"
    getCard={(a) => ({
      imageChip: fmtPrice(a.price) ? { text: fmtPrice(a.price), sub: "entry" } : null,
      pill: a.duration ? { icon: "time-outline", text: a.duration } : null,
    })}
    renderDetail={(a, { openDirections, status }) => (
      <>
        <DetailTitle name={a.name} location={a.location} status={status} />

        <MetaCard
          cells={[
            { big: fmtPrice(a.price) ?? "—", label: "Entry" },
            { rating: a.rating, text: `${a.rating} (${a.reviews})` },
            a.duration ? { icon: "time-outline", text: a.duration } : null,
          ]}
        />

        {!!a.bestTime && <InfoChip icon="sunny-outline" text={`Best time: ${a.bestTime}`} />}

        <DirectionsButton onPress={() => openDirections(a.coordinates, a.name)} />

        {!!a.description && (
          <Section title="About">
            <Text className="text-[13px] text-ink leading-5">{a.description}</Text>
          </Section>
        )}

        {a.features?.length > 0 && (
          <Section title="Features">
            <Chips items={a.features} />
          </Section>
        )}
      </>
    )}
  />
)

export default Attraction
